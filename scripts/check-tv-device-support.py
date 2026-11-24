"""Reject accidental Google Play hardware requirements in the built manifest."""
import glob
import sys
import xml.etree.ElementTree as ET

ANDROID = "{http://schemas.android.com/apk/res/android}"
paths = glob.glob("android/app/build/intermediates/merged_manifests/release/**/AndroidManifest.xml", recursive=True)
if not paths:
    sys.exit("No merged release manifest found; run the release build first.")
optional = {
    "android.hardware.camera", "android.hardware.camera.any",
    "android.hardware.camera.autofocus", "android.hardware.touchscreen",
    "android.hardware.microphone", "android.hardware.wifi",
    "android.hardware.screen.portrait",
}
for path in paths:
    manifest = ET.parse(path).getroot()
    if any(item.get(ANDROID + "name") == "android.permission.RECORD_AUDIO"
           for item in manifest.findall("uses-permission")):
        sys.exit("Unexpected microphone permission in release manifest.")
    features = {item.get(ANDROID + "name"): item.get(ANDROID + "required", "true")
                for item in manifest.findall("uses-feature")}
    missing = sorted(name for name in optional if features.get(name) != "false")
    if missing:
        sys.exit("TV compatibility check failed; hardware must be explicitly optional: " + ", ".join(missing))
    print("TV hardware compatibility passed for version " + manifest.get(ANDROID + "versionCode", "unknown"))
