import React from 'react';
import renderer,{act} from 'react-test-renderer';
import {Linking} from 'react-native';
import {VegaCastScanner} from '../src/components/remote-player/VegaCastScanner';

let mockPermission={granted:false,canAskAgain:false};
const mockRequest=jest.fn();
const mockGet=jest.fn();
jest.mock('expo-camera',()=>({
 CameraView:(props:any)=>require('react').createElement('MockCamera',props),
 useCameraPermissions:()=>[mockPermission,mockRequest,mockGet],
}));
jest.mock('../src/theme/M3PaletteContext',()=>({useM3Colors:()=>({onSurface:'#fff',onSurfaceVariant:'#ddd'})}));
jest.mock('../src/components/ui/MaterialDialogSurface',()=>({__esModule:true,default:(props:any)=>require('react').createElement('MockDialog',props,props.children)}));
jest.mock('../src/components/ui/Button',()=>({__esModule:true,default:(props:any)=>require('react').createElement('MockButton',props,props.children)}));
jest.mock('../src/components/ui/Text',()=>({__esModule:true,default:(props:any)=>require('react').createElement('MockText',props,props.children)}));
const button=(view:renderer.ReactTestRenderer,label:string)=>view.root.findAllByType('MockButton' as any).find(node=>node.props.children===label)!;

beforeEach(()=>{mockPermission={granted:false,canAskAgain:false};mockRequest.mockReset();mockGet.mockReset();});
it('requests camera normally even when a permission query says it cannot ask again',async()=>{
 mockRequest.mockImplementation(async()=>{mockPermission={granted:true,canAskAgain:true};return mockPermission;});
 let view:renderer.ReactTestRenderer;
 await act(async()=>{view=renderer.create(<VegaCastScanner onScan={()=>{}} onClose={()=>{}}/>);});
 expect(button(view!,'Open settings')).toBeUndefined();
 await act(async()=>button(view!,'Allow camera').props.onPress());
 expect(mockRequest).toHaveBeenCalledTimes(1);
 // The real permission hook publishes its new state; mirror that hook update.
 await act(async()=>view!.update(<VegaCastScanner onScan={()=>{}} onClose={()=>{}}/>));
 expect(view!.root.findAllByType('MockCamera' as any)).toHaveLength(1);
 await act(async()=>view!.unmount());
});
it('offers settings only after an actual permission request returns blocked',async()=>{
 mockRequest.mockResolvedValue({granted:false,canAskAgain:false});
 const open=jest.spyOn(Linking,'openSettings').mockResolvedValue(undefined);
 let view:renderer.ReactTestRenderer;
 await act(async()=>{view=renderer.create(<VegaCastScanner onScan={()=>{}} onClose={()=>{}}/>);});
 await act(async()=>button(view!,'Allow camera').props.onPress());
 expect(open).not.toHaveBeenCalled();
 expect(button(view!,'Open settings')).toBeDefined();
 await act(async()=>button(view!,'Open settings').props.onPress());
 expect(open).toHaveBeenCalledTimes(1);
 await act(async()=>view!.unmount());open.mockRestore();
});
