import {isRemotePlaybackCanceled} from '../../lib/remote/remotePlaybackErrors';
import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Alert, Clipboard, View} from 'react-native';
import AppDialog from '../AppDialog';
import GoogleCast, {useCastDevice, useDevices} from 'react-native-google-cast';
import {useRemoteStore} from '../../lib/remote/remoteStore';
import {dlnaService} from '../../lib/remote/dlnaService';
import {remoteDeliveryService} from '../../lib/remote/remoteDeliveryService';
import {remotePlaybackManager} from '../../lib/remote/remotePlaybackManager';
import {RemoteDevice} from '../../lib/remote/types';
import {VegaCastScanner} from './VegaCastScanner';
import {vegaCastService,type VegaReceiver} from '../../lib/remote/vegaCastService';
import {useM3Colors} from '../../theme/M3PaletteContext';
import {isTV} from '../../lib/tv';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import AppText from '../ui/Text';
import {
  RemoteSheet,
  RemoteSheetEmpty,
  RemoteSheetOption,
  RemoteSheetSectionLabel,
} from './RemoteSheet';

interface DevicePickerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Ends casting and leaves the remote screen. */
  onStopCasting: () => void;
}
const castPageUrl='https://cast.vega-app.in/';

export const DevicePickerModal: React.FC<DevicePickerModalProps> = ({
  visible,
  onClose,
  onStopCasting,
}) => {
  const colors = useM3Colors();
  const castDevice = useCastDevice();
  const castDevices = useDevices();
  const connectedDevice = useRemoteStore(state => state.connectedDevice);
  const availableDlnaDevices = useRemoteStore(
    state => state.availableDlnaDevices,
  );
  const isSearchingDlna = useRemoteStore(state => state.isSearchingDlna);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | undefined>();
  const [scannerOpen,setScannerOpen]=useState(false);
  const [showCastInfo,setShowCastInfo]=useState(false);
  const [linkCopied,setLinkCopied]=useState(false);
  const [discoveringVega,setDiscoveringVega]=useState(false);
  const [vegaReceivers,setVegaReceivers]=useState(vegaCastService.getReceivers());
  const [pairingState,setPairingState]=useState(vegaCastService.getPairingState());
  useEffect(()=>vegaCastService.subscribe(()=>{
    setVegaReceivers(vegaCastService.getReceivers());
    const next=vegaCastService.getPairingState();setPairingState({...next});
    setDiscoveringVega(vegaCastService.isDiscovering());
  }),[]);

  const startScan = () => {
    vegaCastService.startDiscovery();
    dlnaService.startDiscovery();
    remoteDeliveryService.startCastDiscovery().catch(error =>
      console.warn('Cast discovery failed to start:', error),
    );
  };

  // Scan for both kinds of device only while the sheet is open.
  useEffect(() => {
    if (!visible || isTV) return;
    setConnectError(undefined);
    startScan();
    return () => {
      vegaCastService.stopDiscovery();vegaCastService.cancelPairing();setScannerOpen(false);setShowCastInfo(false);
      dlnaService.stopDiscovery();
      remoteDeliveryService.stopCastDiscovery().catch(() => {});
    };
  }, [visible]);

  // Close once the requested Cast session is up; report a failed start.
  useEffect(() => {
    if (!connectingId) return;
    if (castDevice?.deviceId === connectingId) {
      setConnectingId(null);
      onClose();
      return;
    }
    const sub = GoogleCast.getSessionManager().onSessionStartFailed(
      (_session, error) => {
        setConnectingId(null);
        setConnectError(error || "Couldn't connect to that device");
      },
    );
    return () => sub.remove();
  }, [castDevice?.deviceId, connectingId, onClose]);

  if (isTV) return null;

  const isCastConnected = (deviceId: string) =>
    castDevice?.deviceId === deviceId && connectedDevice?.type !== 'dlna';

  const handleSelectCast = (deviceId: string) => {
    if (isCastConnected(deviceId)) {
      onClose();
      return;
    }
    setConnectError(undefined);
    setConnectingId(deviceId);
    remotePlaybackManager.connectCast(deviceId).catch((error: Error) => {
      setConnectingId(null);
      if (!isRemotePlaybackCanceled(error)) setConnectError(error.message);
    });
  };

  const handleSelectDlna = (device: RemoteDevice) => {
    onClose();
    remotePlaybackManager.connectDlna(device).catch((error: Error) => {
      if (!isRemotePlaybackCanceled(error))
        useRemoteStore.getState().setErrorMessage(error.message);
    });
  };

  const handleSelectVega=async(device:VegaReceiver)=>{
    if(connectedDevice?.id===device.id&&connectedDevice.type==='vega-cast'){onClose();return;}
    setConnectingId(device.id);setConnectError(undefined);
    try{const receiverId=device.paired?device.id:await vegaCastService.pair(device);await remotePlaybackManager.connectVegaCast(receiverId);onClose();}
    catch(error){if(error instanceof Error&&error.message==='Pairing canceled')return;setConnectError(error instanceof Error?error.message:'Unable to connect to Vega Cast');}
    finally{setConnectingId(null);}
  };
  const handlePair=async(invitation:string)=>{
    setConnectError(undefined);
    try{const receiverId=await vegaCastService.pair(invitation);await remotePlaybackManager.connectVegaCast(receiverId);onClose();}
    catch(error){if(error instanceof Error&&error.message==='Pairing canceled')return;setConnectError(error instanceof Error?error.message:'Pairing failed');}
  };

  // The connected device is excluded by the library's list; show it first.
  const castList = [
    ...(castDevice ? [castDevice] : []),
    ...castDevices.filter(device => device.deviceId !== castDevice?.deviceId),
  ];

  return (
    <>
    <RemoteSheet
      visible={visible}
      title="Play on"
      onClose={onClose}
      headerRight={
        isSearchingDlna || discoveringVega ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <IconButton
            icon="refresh"
            label="Search again"
            contentColor={colors.onSurface}
            onPress={startScan}
          />
        )
      }>
      <View>
      {!!connectedDevice && (
        <View style={{alignItems: 'flex-start', paddingBottom: 8, paddingHorizontal: 16}}>
          <Button
            variant="tonal"
            compact
            onPress={() => {
              onClose();
              onStopCasting();
            }}>
            Stop casting
          </Button>
        </View>
      )}
      {!!connectError && (
        <AppText
          role="bodyMedium"
          style={{color: colors.error, paddingHorizontal: 16, paddingBottom: 8}}>
          {connectError}
        </AppText>
      )}

      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingRight:8}}><RemoteSheetSectionLabel text="Vega Cast" /><View style={{flexDirection:'row',alignItems:'center',gap:12}}><IconButton icon="qrcode-scan" label="Scan Vega Cast QR code" contentColor={colors.onSurfaceVariant} disabled={pairingState.pairing} onPress={()=>setScannerOpen(true)}/><IconButton icon="information-outline" label="Vega Cast connection info" contentColor={colors.onSurfaceVariant} onPress={()=>{setLinkCopied(false);setShowCastInfo(true);}}/></View></View>
      {vegaReceivers.map(device=><View key={device.id} style={{flexDirection:'row',alignItems:'center'}}><View style={{flex:1,minWidth:0}}><RemoteSheetOption icon="television-play" title={device.name}
        supportingText={connectingId===device.id?(pairingState.pairing?'Confirm the number on your receiver…':'Connecting…'):device.paired?'Paired':'Available'}
        selected={connectedDevice?.type==='vega-cast'&&connectedDevice.id===device.id}
        onPress={()=>{if(!pairingState.pairing)void handleSelectVega(device);}}/></View>{device.paired&&!(connectedDevice?.type==='vega-cast'&&connectedDevice.id===device.id)&&<IconButton icon="delete-outline" label={`Forget ${device.name}`} contentColor={colors.error} disabled={pairingState.pairing||connectingId===device.id} onPress={()=>Alert.alert('Forget receiver?',`Remove the saved pairing for ${device.name}? You will need to pair again. Current playback will continue.`,[{text:'Cancel',style:'cancel'},{text:'Forget',style:'destructive',onPress:()=>vegaCastService.forget(device.id)}])}/>}</View>)}
      {!vegaReceivers.length&&<RemoteSheetEmpty text={discoveringVega?'Searching for Vega Cast receivers…':'No receivers found'}/>}
      <View style={{paddingHorizontal:16,paddingTop:8,paddingBottom:16,gap:10}}>
        {!!pairingState.confirmation&&pairingState.pairing&&<AppText role="bodyMedium" style={{color:colors.primary}}>Confirm {pairingState.confirmation} on receiver</AppText>}

        {!!pairingState.invitation&&!pairingState.pairing&&<Button variant="tonal" onPress={()=>{void handlePair(pairingState.invitation);}}>Connect scanned receiver</Button>}
      </View>
      <RemoteSheetSectionLabel text="Google Cast" />
      {castList.length === 0 ? (
        <RemoteSheetEmpty text="Searching for Cast devices on this Wi-Fi…" />
      ) : (
        castList.map(device => (
          <RemoteSheetOption
            key={device.deviceId}
            icon={isCastConnected(device.deviceId) ? 'cast-connected' : 'cast'}
            title={device.friendlyName}
            supportingText={
              connectingId === device.deviceId
                ? 'Connecting…'
                : [device.modelName, device.ipAddress].filter(Boolean).join(' · ')
            }
            selected={isCastConnected(device.deviceId)}
            onPress={() => handleSelectCast(device.deviceId)}
          />
        ))
      )}

      <RemoteSheetSectionLabel text="DLNA" />
      {availableDlnaDevices.length === 0 ? (
        <RemoteSheetEmpty
          text={
            isSearchingDlna
              ? 'Searching this Wi-Fi network…'
              : 'No DLNA devices found on this Wi-Fi network'
          }
        />
      ) : (
        availableDlnaDevices.map(device => (
          <RemoteSheetOption
            key={device.id}
            icon="television"
            title={device.name}
            supportingText={[device.model, device.host].filter(Boolean).join(' · ')}
            selected={connectedDevice?.id === device.id}
            onPress={() => handleSelectDlna(device)}
          />
        ))
      )}

      </View>
      {visible&&scannerOpen&&<VegaCastScanner onClose={()=>setScannerOpen(false)} onScan={invitation=>{setScannerOpen(false);void handlePair(invitation);}}/>}
      <AppDialog
        visible={visible&&showCastInfo}
        title="Vega Cast"
        message={`Open this link on your TV or computer, then select the receiver or scan its QR code.\n\n[${castPageUrl}](${castPageUrl})`}
        messageFormat="markdown"
        primary={colors.primary}
        onDismiss={()=>setShowCastInfo(false)}
        actions={[
          {label:linkCopied?'Copied':'Copy link',dismissOnPress:false,onPress:()=>{Clipboard.setString(castPageUrl);setLinkCopied(true);}},
          {label:'Done',variant:'primary'},
        ]}
      />
    </RemoteSheet>
    </>
  );
};
