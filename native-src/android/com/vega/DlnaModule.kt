package com.vega

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.w3c.dom.Element
import java.io.ByteArrayInputStream
import java.net.DatagramPacket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.xml.parsers.DocumentBuilderFactory

class DlnaModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "VegaDlna"
        private const val TAG = "DlnaModule"
        private const val DEVICE_FOUND_EVENT = "VegaDlnaDeviceFound"
        private const val SSDP_PORT = 1900
        private const val SSDP_ADDRESS = "239.255.255.250"
    }

    override fun getName(): String = NAME

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    private var multicastLock: WifiManager.MulticastLock? = null
    @Volatile private var isSearching = false
    @Volatile private var lastSoapError: String? = null
    private val discoveredDevices = ConcurrentHashMap<String, Boolean>()

    private fun sendEvent(eventName: String, params: Any?) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    @ReactMethod
    fun startDiscovery(promise: Promise) {
        if (isSearching) {
            promise.resolve(true)
            return
        }

        discoveredDevices.clear()
        isSearching = true

        Thread {
            var socket: MulticastSocket? = null
            try {
                val wifiManager = reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                multicastLock = wifiManager?.createMulticastLock("VegaDlnaDiscovery")?.apply {
                    setReferenceCounted(false)
                    acquire()
                }

                socket = MulticastSocket(null).apply {
                    reuseAddress = true
                    broadcast = true
                    soTimeout = 4000
                }

                // Explicitly bind socket to Wi-Fi interface/network to avoid cellular routing EPERM
                val cm = reactContext.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
                val wifiNetwork = cm?.allNetworks?.firstOrNull { net ->
                    cm.getNetworkCapabilities(net)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
                }

                val wifiIface = NetworkInterface.getNetworkInterfaces().toList().firstOrNull { iface ->
                    (iface.name.startsWith("wlan") || iface.name.startsWith("wifi")) && iface.isUp
                }

                if (wifiIface != null) {
                    try {
                        socket.networkInterface = wifiIface
                    } catch (e: Exception) {
                        VegaLog.w(TAG, "Failed to set networkInterface: ${e.message}")
                    }
                    val wifiIp = wifiIface.inetAddresses.toList().firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
                    if (wifiIp != null) {
                        socket.bind(InetSocketAddress(wifiIp, 0))
                    } else {
                        socket.bind(InetSocketAddress(0))
                    }
                } else {
                    socket.bind(InetSocketAddress(0))
                }

                if (wifiNetwork != null) {
                    try {
                        wifiNetwork.bindSocket(socket)
                    } catch (e: Exception) {
                        VegaLog.w(TAG, "Failed to bindSocket to Wi-Fi: ${e.message}")
                    }
                }

                fun createSearchPacket(searchTarget: String, targetAddress: InetAddress): DatagramPacket {
                    // Built by hand: trimIndent() drops the blank line that ends the
                    // headers, and renderers ignore a request without it.
                    val mSearch = "M-SEARCH * HTTP/1.1\r\n" +
                        "HOST: $SSDP_ADDRESS:$SSDP_PORT\r\n" +
                        "MAN: \"ssdp:discover\"\r\n" +
                        "MX: 3\r\n" +
                        "ST: $searchTarget\r\n" +
                        "\r\n"
                    val sendData = mSearch.toByteArray(Charsets.UTF_8)
                    return DatagramPacket(sendData, sendData.size, targetAddress, SSDP_PORT)
                }

                val multicastAddr = InetAddress.getByName(SSDP_ADDRESS)
                val broadcastAddr = InetAddress.getByName("255.255.255.255")

                val targets = listOf("urn:schemas-upnp-org:device:MediaRenderer:1", "urn:vega:service:cast:1", "ssdp:all")
                for (target in targets) {
                    try {
                        socket.send(createSearchPacket(target, multicastAddr))
                        socket.send(createSearchPacket(target, broadcastAddr))
                    } catch (e: Exception) {
                        VegaLog.w(TAG, "SSDP send error for $target: ${e.message}")
                    }
                }

                Thread.sleep(150)
                for (target in targets) {
                    try {
                        socket.send(createSearchPacket(target, multicastAddr))
                    } catch (_: Exception) {}
                }

                val buffer = ByteArray(4096)
                val startTime = System.currentTimeMillis()

                while (isSearching && (System.currentTimeMillis() - startTime) < 7000) {
                    try {
                        val receivePacket = DatagramPacket(buffer, buffer.size)
                        socket.receive(receivePacket)
                        val response = String(receivePacket.data, 0, receivePacket.length, Charsets.UTF_8)

                        val castService = extractHeader(response, "X-VEGA-CAST-SERVICE")
                        if (!castService.isNullOrBlank()) {
                            try {
                                val service = java.net.URI(castService)
                                if (service.scheme in listOf("http", "https") && service.host == receivePacket.address.hostAddress &&
                                    service.userInfo == null && service.path == "/vega-cast/v1") {
                                    sendEvent("VegaCastServiceDiscovered", Arguments.createMap().apply { putString("serviceUrl", castService) })
                                }
                            } catch (_: Exception) {}
                            continue
                        }

                        val location = extractHeader(response, "LOCATION")
                        if (!location.isNullOrBlank() && discoveredDevices.putIfAbsent(location, true) == null) {
                            VegaLog.i(TAG, "Discovered SSDP location: $location")
                            fetchAndParseDeviceDescription(location)
                        }
                    } catch (_: java.net.SocketTimeoutException) {
                        break
                    } catch (e: Exception) {
                        VegaLog.w(TAG, "SSDP receive error: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                VegaLog.e(TAG, "Discovery error", e)
            } finally {
                isSearching = false
                try {
                    socket?.close()
                } catch (_: Exception) {}
                try {
                    multicastLock?.release()
                } catch (_: Exception) {}
                multicastLock = null
            }
        }.start()

        promise.resolve(true)
    }

    @ReactMethod
    fun stopDiscovery(promise: Promise) {
        isSearching = false
        try {
            multicastLock?.release()
        } catch (_: Exception) {}
        multicastLock = null
        promise.resolve(true)
    }

    private fun extractHeader(response: String, headerName: String): String? {
        val lines = response.split("\r\n")
        val prefix = "${headerName.uppercase()}:"
        for (line in lines) {
            if (line.uppercase().startsWith(prefix)) {
                return line.substring(prefix.length).trim()
            }
        }
        return null
    }

    private fun fetchAndParseDeviceDescription(locationUrl: String) {
        Thread {
            try {
                readDeviceDescription(locationUrl)?.let { sendEvent(DEVICE_FOUND_EVENT, it) }
            } catch (e: Exception) {
                VegaLog.w(TAG, "Failed to parse device description from $locationUrl: ${e.message}")
            }
        }.start()
    }

    /**
     * Adds a renderer the user typed in, for networks where SSDP multicast is
     * blocked. Accepts "host:port", "host:port/path" or a full description URL.
     */
    @ReactMethod
    fun addDeviceByAddress(address: String, promise: Promise) {
        Thread {
            val input = address.trim().trimEnd('/')
            val candidates = when {
                input.isEmpty() -> emptyList()
                input.contains("://") -> listOf(input)
                else -> listOf("http://$input/", "http://$input/description.xml")
            }
            for (location in candidates) {
                try {
                    val device = readDeviceDescription(location) ?: continue
                    discoveredDevices[location] = true
                    sendEvent(DEVICE_FOUND_EVENT, device.copy())
                    promise.resolve(device)
                    return@Thread
                } catch (e: Exception) {
                    VegaLog.w(TAG, "No renderer at $location: ${e.message}")
                }
            }
            promise.reject("DLNA_NOT_FOUND", "No DLNA renderer found at $address")
        }.start()
    }

    /** Fetches a UPnP description; null when it has no AVTransport service. */
    private fun readDeviceDescription(locationUrl: String): WritableMap? {
        val request = Request.Builder().url(locationUrl).build()
        val xml = httpClient.newCall(request).execute().use { it.body?.string() } ?: return null
        
        val baseUrl = URL(locationUrl)
        val host = baseUrl.host
        val port = baseUrl.port

        val factory = DocumentBuilderFactory.newInstance()
        factory.isNamespaceAware = true
        val builder = factory.newDocumentBuilder()
        val doc = builder.parse(ByteArrayInputStream(xml.toByteArray(Charsets.UTF_8)))

        val friendlyName = doc.getElementsByTagName("friendlyName").item(0)?.textContent ?: "DLNA TV ($host)"
        val udn = doc.getElementsByTagName("UDN").item(0)?.textContent ?: locationUrl
        val modelName = doc.getElementsByTagName("modelName").item(0)?.textContent ?: ""
        val manufacturer = doc.getElementsByTagName("manufacturer").item(0)?.textContent ?: ""

        var avTransportControlUrl: String? = null
        var renderingControlUrl: String? = null

        val serviceNodes = doc.getElementsByTagName("service")
        for (i in 0 until serviceNodes.length) {
            val service = serviceNodes.item(i) as? Element ?: continue
            val serviceType = service.getElementsByTagName("serviceType").item(0)?.textContent ?: ""
            val controlUrlRel = service.getElementsByTagName("controlURL").item(0)?.textContent ?: ""

            if (serviceType.contains(":AVTransport:")) {
                avTransportControlUrl = resolveUrl(baseUrl, controlUrlRel)
            } else if (serviceType.contains(":RenderingControl:")) {
                renderingControlUrl = resolveUrl(baseUrl, controlUrlRel)
            }
        }

        if (!avTransportControlUrl.isNullOrBlank()) {
            return Arguments.createMap().apply {
                putString("id", udn)
                putString("name", friendlyName)
                putString("type", "dlna")
                putString("host", host)
                putInt("port", port)
                putString("model", modelName)
                putString("manufacturer", manufacturer)
                putString("controlUrl", avTransportControlUrl)
                putString("renderingControlUrl", renderingControlUrl ?: "")
            }
        }
        return null
    }

    private fun resolveUrl(base: URL, relativePath: String): String {
        return try {
            URL(base, relativePath).toString()
        } catch (_: Exception) {
            relativePath
        }
    }

    @ReactMethod
    fun setAVTransportURI(controlUrl: String, mediaUrl: String, title: String, subtitleUrl: String?, promise: Promise) {
        Thread {
            try {
                VegaLog.i(TAG, "setAVTransportURI: mediaUrl=$mediaUrl subtitleUrl=$subtitleUrl controlUrl=$controlUrl")
                val subXml = if (!subtitleUrl.isNullOrBlank()) {
                    val escapedSub = escapeXml(subtitleUrl)
                    val srtUrl = if (subtitleUrl.endsWith(".vtt", ignoreCase = true)) {
                        subtitleUrl.substringBeforeLast(".vtt") + ".srt"
                    } else {
                        subtitleUrl
                    }
                    val escapedSrt = escapeXml(srtUrl)
                    """<res protocolInfo="http-get:*:text/vtt:*">$escapedSub</res>""" +
                    """<res protocolInfo="http-get:*:text/srt:*">$escapedSrt</res>""" +
                    """<res protocolInfo="http-get:*:smi/caption:*">$escapedSrt</res>""" +
                    """<sec:CaptionInfoEx sec:type="vtt">$escapedSub</sec:CaptionInfoEx>""" +
                    """<sec:CaptionInfoEx sec:type="srt">$escapedSrt</sec:CaptionInfoEx>""" +
                    """<sec:CaptionInfo sec:type="vtt">$escapedSub</sec:CaptionInfo>""" +
                    """<sec:CaptionInfo sec:type="srt">$escapedSrt</sec:CaptionInfo>""" +
                    """<upnp:subtitle>$escapedSub</upnp:subtitle>"""
                } else ""

                // DIDL-Lite is a complete XML document, so it is escaped once as a whole
                // into the SOAP argument; its own text nodes are escaped separately.
                val didlLite = """<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:sec="http://www.sec.co.kr/">""" +
                    """<item id="0" parentID="-1" restricted="1">""" +
                    "<dc:title>${escapeXml(title)}</dc:title>" +
                    "<upnp:class>object.item.videoItem</upnp:class>" +
                    """<res protocolInfo="http-get:*:video/mp4:DLNA.ORG_OP=01;DLNA.ORG_CI=0">${escapeXml(mediaUrl)}</res>""" +
                    subXml +
                    "</item></DIDL-Lite>"

                val soapBody = """
                    <?xml version="1.0" encoding="utf-8"?>
                    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
                        <s:Body>
                            <u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
                                <InstanceID>0</InstanceID>
                                <CurrentURI>${escapeXml(mediaUrl)}</CurrentURI>
                                <CurrentURIMetaData>${escapeXml(didlLite)}</CurrentURIMetaData>
                            </u:SetAVTransportURI>
                        </s:Body>
                    </s:Envelope>
                """.trimIndent()

                val res = sendSoapAction(controlUrl, "urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI", soapBody)
                reactContext.runOnUiQueueThread {
                    if (res != null) {
                        promise.resolve(true)
                    } else {
                        promise.reject("SOAP_ERROR", "SetAVTransportURI failed: ${lastSoapError ?: "Unknown error"}")
                    }
                }
            } catch (e: Exception) {
                reactContext.runOnUiQueueThread { promise.reject("SOAP_ERROR", e.message, e) }
            }
        }.start()
    }

    @ReactMethod
    fun play(controlUrl: String, promise: Promise) {
        Thread {
            val soapBody = """
                <?xml version="1.0" encoding="utf-8"?>
                <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
                    <s:Body>
                        <u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
                            <InstanceID>0</InstanceID>
                            <Speed>1</Speed>
                        </u:Play>
                    </s:Body>
                </s:Envelope>
            """.trimIndent()
            val res = sendSoapAction(controlUrl, "urn:schemas-upnp-org:service:AVTransport:1#Play", soapBody)
            reactContext.runOnUiQueueThread {
                if (res != null) promise.resolve(true) else promise.reject("SOAP_ERROR", "Play failed")
            }
        }.start()
    }

    @ReactMethod
    fun pause(controlUrl: String, promise: Promise) {
        Thread {
            val soapBody = """
                <?xml version="1.0" encoding="utf-8"?>
                <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
                    <s:Body>
                        <u:Pause xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
                            <InstanceID>0</InstanceID>
                        </u:Pause>
                    </s:Body>
                </s:Envelope>
            """.trimIndent()
            val res = sendSoapAction(controlUrl, "urn:schemas-upnp-org:service:AVTransport:1#Pause", soapBody)
            reactContext.runOnUiQueueThread {
                if (res != null) promise.resolve(true) else promise.reject("SOAP_ERROR", "Pause failed")
            }
        }.start()
    }

    @ReactMethod
    fun stop(controlUrl: String, promise: Promise) {
        Thread {
            val soapBody = """
                <?xml version="1.0" encoding="utf-8"?>
                <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
                    <s:Body>
                        <u:Stop xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
                            <InstanceID>0</InstanceID>
                        </u:Stop>
                    </s:Body>
                </s:Envelope>
            """.trimIndent()
            val res = sendSoapAction(controlUrl, "urn:schemas-upnp-org:service:AVTransport:1#Stop", soapBody)
            reactContext.runOnUiQueueThread {
                if (res != null) promise.resolve(true) else promise.reject("SOAP_ERROR", "Stop failed")
            }
        }.start()
    }

    @ReactMethod
    fun seek(controlUrl: String, seconds: Double, promise: Promise) {
        Thread {
            val timeStr = formatSecondsToHms(seconds)
            val soapBody = """
                <?xml version="1.0" encoding="utf-8"?>
                <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
                    <s:Body>
                        <u:Seek xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
                            <InstanceID>0</InstanceID>
                            <Unit>REL_TIME</Unit>
                            <Target>$timeStr</Target>
                        </u:Seek>
                    </s:Body>
                </s:Envelope>
            """.trimIndent()
            val res = sendSoapAction(controlUrl, "urn:schemas-upnp-org:service:AVTransport:1#Seek", soapBody)
            reactContext.runOnUiQueueThread {
                if (res != null) promise.resolve(true) else promise.reject("SOAP_ERROR", "Seek failed")
            }
        }.start()
    }

    @ReactMethod
    fun getPositionInfo(controlUrl: String, promise: Promise) {
        Thread {
            try {
                val soapBody = """
                    <?xml version="1.0" encoding="utf-8"?>
                    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
                        <s:Body>
                            <u:GetPositionInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
                                <InstanceID>0</InstanceID>
                            </u:GetPositionInfo>
                        </s:Body>
                    </s:Envelope>
                """.trimIndent()
                val responseXml = sendSoapAction(controlUrl, "urn:schemas-upnp-org:service:AVTransport:1#GetPositionInfo", soapBody)
                if (responseXml == null) {
                    reactContext.runOnUiQueueThread { promise.reject("SOAP_ERROR", "GetPositionInfo returned null") }
                    return@Thread
                }

                val duration = parseTagTime(responseXml, "TrackDuration")
                val relTime = parseTagTime(responseXml, "RelTime")
                val trackUri = parseTagString(responseXml, "TrackURI")

                val result = Arguments.createMap().apply {
                    putDouble("duration", duration)
                    putDouble("position", relTime)
                    if (!trackUri.isNullOrBlank()) {
                        putString("trackUri", trackUri)
                    }
                }
                reactContext.runOnUiQueueThread { promise.resolve(result) }
            } catch (e: Exception) {
                reactContext.runOnUiQueueThread { promise.reject("SOAP_ERROR", e.message, e) }
            }
        }.start()
    }

    @ReactMethod
    fun getMediaInfo(controlUrl: String, promise: Promise) {
        Thread {
            try {
                val soapBody = """
                    <?xml version="1.0" encoding="utf-8"?>
                    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
                        <s:Body>
                            <u:GetMediaInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
                                <InstanceID>0</InstanceID>
                            </u:GetMediaInfo>
                        </s:Body>
                    </s:Envelope>
                """.trimIndent()
                val responseXml = sendSoapAction(controlUrl, "urn:schemas-upnp-org:service:AVTransport:1#GetMediaInfo", soapBody)
                if (responseXml == null) {
                    reactContext.runOnUiQueueThread { promise.reject("SOAP_ERROR", "GetMediaInfo returned null") }
                    return@Thread
                }
                val currentUri = parseTagString(responseXml, "CurrentURI") ?: ""
                val result = Arguments.createMap().apply {
                    putString("currentUri", currentUri)
                }
                reactContext.runOnUiQueueThread { promise.resolve(result) }
            } catch (e: Exception) {
                reactContext.runOnUiQueueThread { promise.reject("SOAP_ERROR", e.message, e) }
            }
        }.start()
    }

    @ReactMethod
    fun setVolume(renderingControlUrl: String, volume0to100: Int, promise: Promise) {
        Thread {
            val clamped = volume0to100.coerceIn(0, 100)
            val soapBody = """
                <?xml version="1.0" encoding="utf-8"?>
                <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
                    <s:Body>
                        <u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
                            <InstanceID>0</InstanceID>
                            <Channel>Master</Channel>
                            <DesiredVolume>$clamped</DesiredVolume>
                        </u:SetVolume>
                    </s:Body>
                </s:Envelope>
            """.trimIndent()
            val res = sendSoapAction(renderingControlUrl, "urn:schemas-upnp-org:service:RenderingControl:1#SetVolume", soapBody)
            reactContext.runOnUiQueueThread {
                if (res != null) promise.resolve(true) else promise.reject("SOAP_ERROR", "SetVolume failed")
            }
        }.start()
    }

    @ReactMethod
    fun getVolume(renderingControlUrl: String, promise: Promise) {
        Thread {
            val soapBody = """
                <?xml version="1.0" encoding="utf-8"?>
                <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
                    <s:Body>
                        <u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
                            <InstanceID>0</InstanceID>
                            <Channel>Master</Channel>
                        </u:GetVolume>
                    </s:Body>
                </s:Envelope>
            """.trimIndent()
            val res = sendSoapAction(renderingControlUrl, "urn:schemas-upnp-org:service:RenderingControl:1#GetVolume", soapBody)
            val volume = res?.let { parseTagString(it, "CurrentVolume")?.trim()?.toIntOrNull() }
            reactContext.runOnUiQueueThread {
                if (volume != null) promise.resolve(volume) else promise.reject("SOAP_ERROR", "GetVolume failed")
            }
        }.start()
    }

    private fun sendSoapAction(controlUrl: String, soapAction: String, soapBody: String): String? {
        lastSoapError = null
        return try {
            val body = soapBody.toRequestBody("text/xml; charset=\"utf-8\"".toMediaType())
            val request = Request.Builder()
                .url(controlUrl)
                .addHeader("SOAPAction", "\"$soapAction\"")
                .post(body)
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    response.body?.string() ?: ""
                } else {
                    val errBody = response.body?.string() ?: ""
                    val code = parseTagString(errBody, "errorCode")
                    val desc = parseTagString(errBody, "errorDescription")
                    lastSoapError = if (!code.isNullOrBlank() || !desc.isNullOrBlank()) {
                        "UPnP error ${code ?: ""}: ${desc ?: ""}".trim()
                    } else {
                        "HTTP ${response.code}: ${errBody.take(120)}"
                    }
                    VegaLog.w(TAG, "SOAP request $soapAction to $controlUrl returned ${response.code}: $lastSoapError")
                    null
                }
            }
        } catch (e: Exception) {
            lastSoapError = e.message ?: "Network error"
            VegaLog.w(TAG, "SOAP execution error for $soapAction", e)
            null
        }
    }

    private fun escapeXml(str: String): String {
        return str
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&apos;")
    }

    private fun formatSecondsToHms(seconds: Double): String {
        val totalSecs = seconds.toLong().coerceAtLeast(0)
        val h = totalSecs / 3600
        val m = (totalSecs % 3600) / 60
        val s = totalSecs % 60
        return String.format("%02d:%02d:%02d", h, m, s)
    }

    private fun parseTagTime(xml: String, tagName: String): Double {
        val openTag = "<$tagName>"
        val closeTag = "</$tagName>"
        val start = xml.indexOf(openTag)
        if (start == -1) return 0.0
        val end = xml.indexOf(closeTag, start)
        if (end == -1) return 0.0
        val timeStr = xml.substring(start + openTag.length, end).trim()
        val parts = timeStr.split(":")
        return when (parts.size) {
            3 -> (parts[0].toDoubleOrNull() ?: 0.0) * 3600 + (parts[1].toDoubleOrNull() ?: 0.0) * 60 + (parts[2].toDoubleOrNull() ?: 0.0)
            2 -> (parts[0].toDoubleOrNull() ?: 0.0) * 60 + (parts[1].toDoubleOrNull() ?: 0.0)
            else -> timeStr.toDoubleOrNull() ?: 0.0
        }
    }

    private fun parseTagString(xml: String, tagName: String): String? {
        val openTag = "<$tagName>"
        val closeTag = "</$tagName>"
        val start = xml.indexOf(openTag)
        if (start == -1) return null
        val end = xml.indexOf(closeTag, start)
        if (end == -1) return null
        return xml.substring(start + openTag.length, end).trim()
    }
}
