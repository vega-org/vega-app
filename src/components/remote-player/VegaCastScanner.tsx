import React,{useEffect,useRef,useState} from 'react';
import {AppState,View,Linking,Platform,useWindowDimensions} from 'react-native';
import {CameraView,useCameraPermissions} from 'expo-camera';
import {useM3Colors} from '../../theme/M3PaletteContext';
import AppText from '../ui/Text';
import Button from '../ui/Button';
import MaterialDialogSurface from '../ui/MaterialDialogSurface';
export function VegaCastScanner({onScan,onClose}:{onScan:(invitation:string)=>void;onClose:()=>void}){
 const colors=useM3Colors();const {width,height}=useWindowDimensions();
 const [permission,requestPermission,getPermission]=useCameraPermissions();const scanned=useRef(false);
 const [cameraError,setCameraError]=useState(false);
 const [permissionBlocked,setPermissionBlocked]=useState(false);
 const [requesting,setRequesting]=useState(false);
 const askForCamera=async()=>{
  if(requesting)return;
  setRequesting(true);
  try{
   // A query cannot reliably distinguish "Ask every time" from a blocked
   // permission. Request normally before offering Settings for this attempt.
   const result=await requestPermission();
   setPermissionBlocked(!result.granted&&!result.canAskAgain);
  }catch{setCameraError(true);}finally{setRequesting(false);}
 };
 useEffect(()=>{
  const subscription=AppState.addEventListener('change',state=>{if(state==='active'){setPermissionBlocked(false);void getPermission();}});
  return()=>subscription.remove();
 },[getPermission]);
 return <MaterialDialogSurface visible onDismiss={onClose} style={{width:Math.min(360,width-48),maxHeight:height-48}}>
  <View style={{gap:20}}>
   <AppText role="titleLarge" style={{color:colors.onSurface}}>Scan QR code</AppText>
   {cameraError?<AppText role="bodyMedium" style={{color:colors.onSurfaceVariant}}>Camera unavailable. Select a receiver from the device list.</AppText>
    :permission?.granted?<CameraView style={{height:Math.min(280,height*.4),width:'100%',borderRadius:16,overflow:'hidden'}} facing="back" onMountError={()=>setCameraError(true)} barcodeScannerSettings={{barcodeTypes:['qr']}} onBarcodeScanned={({data})=>{if(!scanned.current&&/^vega-cast:\/\/pair\?/i.test(data)){scanned.current=true;onScan(data);}}}/>
    :<AppText role="bodyMedium" style={{color:colors.onSurfaceVariant}}>{!permission?'Checking camera access…':permissionBlocked?'Android is not showing the camera prompt. Check camera access in Settings.':Platform.OS==='android'?'Allow camera access to scan the QR code. You can choose “Only this time”.':'Allow camera access to scan the QR code.'}</AppText>}
   <View style={{flexDirection:'row',justifyContent:'flex-end',gap:8}}>
    <Button variant="text" onPress={onClose}>Cancel</Button>
    {!cameraError&&permission&&!permission.granted&&<Button disabled={requesting} onPress={()=>{if(permissionBlocked)void Linking.openSettings();else void askForCamera();}}>{permissionBlocked?'Open settings':'Allow camera'}</Button>}
   </View>
  </View>
 </MaterialDialogSurface>;
}
