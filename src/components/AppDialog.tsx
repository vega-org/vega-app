import {fillMaxWidth, padding} from '@expo/ui/jetpack-compose/modifiers';
import {MaterialCommunityIcons} from '@expo/vector-icons';
import {
  AlertDialog,
  Column,
  LinearProgressIndicator,
  Host,
  RNHostView,
  Text,
  TextButton,
} from '@expo/ui/jetpack-compose';
import React from 'react';
import {ActivityIndicator, Modal, ScrollView, Text as ReactNativeText, View} from 'react-native';
import Markdown, {MarkdownIt} from 'react-native-markdown-display';
import {useM3Colors, useM3HostTheme} from '../theme/M3PaletteContext';
import {isTV} from '../lib/tv';
import {TVFocusable} from './tv/TVFocusable';

const dialogMarkdown = MarkdownIt({typographer: true, linkify: true});

export type AppDialogVariant = 'info' | 'success' | 'warning' | 'error';

export interface AppDialogAction {
  label: string;
  onPress?: () => void;
  variant?: 'default' | 'primary' | 'destructive';
  testID?: string;
  disabled?: boolean;
  dismissOnPress?: boolean;
}

interface AppDialogProps {
  visible: boolean;
  title: string;
  message: string;
  progress?: number | null;
  messageFormat?: 'plain' | 'markdown';
  primary: string;
  variant?: AppDialogVariant;
  actions?: AppDialogAction[];
  onDismiss: () => void;
}

const variantStyles: Record<
  AppDialogVariant,
  {
    icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
    colorRole: 'primary' | 'tertiary' | 'secondary' | 'error';
  }
> = {
  info: {icon: 'information-outline', colorRole: 'primary'},
  success: {icon: 'check-circle-outline', colorRole: 'tertiary'},
  warning: {icon: 'alert-outline', colorRole: 'secondary'},
  error: {icon: 'alert-circle-outline', colorRole: 'error'},
};

const AppDialog = ({
  visible,
  title,
  message,
  progress,
  messageFormat = 'plain',
  variant = 'info',
  actions = [{label: 'OK', variant: 'primary'}],
  onDismiss,
}: AppDialogProps) => {
  const appearance = variantStyles[variant];
  const colors = useM3Colors();
  const hostTheme = useM3HostTheme();
  const iconColor = colors[appearance.colorRole];
  const confirmAction = actions[actions.length - 1];
  const dismissAction = actions.length > 1 ? actions[0] : undefined;

  const handleAction = (action: AppDialogAction) => {
    action.onPress?.();
    if (action.dismissOnPress !== false) {
      onDismiss();
    }
  };

  if (!visible) {
    return null;
  }

  const progressBar = progress === null ? (
    <ActivityIndicator color={colors.primary} />
  ) : progress === undefined ? null : (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{min: 0, max: 100, now: Math.floor(progress * 100)}}
      style={{
        backgroundColor: colors.surfaceContainerHighest,
        borderRadius: 4,
        height: 6,
        marginTop: 12,
        overflow: 'hidden',
      }}>
      <View
        style={{
          backgroundColor: colors.primary,
          height: '100%',
          width: `${progress * 100}%`,
        }}
      />
    </View>
  );

  if (isTV) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onDismiss}>
        <View
          style={{
            alignItems: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            flex: 1,
            justifyContent: 'center',
            padding: 32,
          }}>
          <View
            style={{
              backgroundColor: colors.surfaceContainerHigh,
              borderColor: colors.outlineVariant,
              borderRadius: 24,
              borderWidth: 1,
              maxWidth: 540,
              padding: 24,
              width: '100%',
            }}>
            <View
              style={{
                alignItems: 'center',
                flexDirection: 'row',
                marginBottom: 16,
              }}>
              <MaterialCommunityIcons
                name={appearance.icon}
                size={24}
                color={iconColor}
              />
              <ReactNativeText
                testID="app-dialog-title"
                style={{
                  color: colors.onSurface,
                  flex: 1,
                  fontSize: 20,
                  fontWeight: '700',
                  marginLeft: 10,
                }}>
                {title}
              </ReactNativeText>
            </View>

            <ScrollView style={{marginBottom: 20, maxHeight: 240}}>
              {messageFormat === 'markdown' ? (
                <View testID="app-dialog-message">
                  <Markdown
                    markdownit={dialogMarkdown}
                    style={{
                      body: {color: colors.onSurfaceVariant, fontSize: 15},
                      paragraph: {marginBottom: 8},
                      link: {color: colors.primary, textDecorationLine: 'underline'},
                    }}>
                    {message}
                  </Markdown>
                </View>
              ) : (
                <ReactNativeText
                  testID="app-dialog-message"
                  style={{
                    color: colors.onSurfaceVariant,
                    fontSize: 15,
                    lineHeight: 22,
                  }}>
                  {message}
                </ReactNativeText>
              )}
              {progressBar}
            </ScrollView>

            <View
              style={{
                flexDirection: 'row',
                gap: 12,
                justifyContent: 'flex-end',
              }}>
              {dismissAction ? (
                <TVFocusable
                  testID={dismissAction.testID}
                  hasTVPreferredFocus={confirmAction?.variant === 'destructive'}
                  onPress={() => handleAction(dismissAction)}
                  disabled={dismissAction.disabled}
                  borderRadius={12}
                  accessibilityRole="button"
                  accessibilityLabel={dismissAction.label}
                  style={{
                    backgroundColor: colors.surfaceContainerHighest,
                    borderRadius: 12,
                    paddingHorizontal: 20,
                    paddingVertical: 10,
                  }}>
                  <ReactNativeText
                    style={{
                      color: colors.onSurfaceVariant,
                      fontSize: 15,
                      fontWeight: '700',
                    }}>
                    {dismissAction.label}
                  </ReactNativeText>
                </TVFocusable>
              ) : null}

              {confirmAction ? (
                <TVFocusable
                  testID={confirmAction.testID}
                  hasTVPreferredFocus={confirmAction.variant !== 'destructive'}
                  onPress={() => handleAction(confirmAction)}
                  disabled={confirmAction.disabled}
                  borderRadius={12}
                  accessibilityRole="button"
                  accessibilityLabel={confirmAction.label}
                  style={{
                    backgroundColor:
                      confirmAction.variant === 'destructive'
                        ? colors.error
                        : colors.primary,
                    borderRadius: 12,
                    paddingHorizontal: 24,
                    paddingVertical: 10,
                  }}>
                  <ReactNativeText
                    style={{
                      color:
                        confirmAction.variant === 'destructive'
                          ? colors.onError
                          : colors.onPrimary,
                      fontSize: 15,
                      fontWeight: '700',
                    }}>
                    {confirmAction.label}
                  </ReactNativeText>
                </TVFocusable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <View
      pointerEvents="box-none"
      style={{left: 0, position: 'absolute', top: 0, zIndex: 1000}}>
      <Host matchContents {...hostTheme}>
        <AlertDialog
          colors={{
            containerColor: colors.surfaceContainerHigh,
            iconContentColor: iconColor,
            titleContentColor: colors.onSurface,
            textContentColor: colors.onSurfaceVariant,
          }}
          onDismissRequest={onDismiss}>
          <AlertDialog.Title>
            <RNHostView matchContents>
              <View
                style={{
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'flex-start',
                  width: 280,
                }}>
                <MaterialCommunityIcons
                  name={appearance.icon}
                  size={22}
                  color={iconColor}
                />
                <ReactNativeText
                  testID="app-dialog-title"
                  style={{
                    color: colors.onSurface,
                    flex: 1,
                    fontSize: 20,
                    fontWeight: '700',
                    marginLeft: 10,
                    textAlign: 'left',
                  }}>
                  {title}
                </ReactNativeText>
              </View>
            </RNHostView>
          </AlertDialog.Title>
          <AlertDialog.Text>
            {messageFormat === 'markdown' ? (
              <RNHostView matchContents>
                <ScrollView
                  nestedScrollEnabled
                  style={{maxHeight: 360, width: 280}}
                  contentContainerStyle={{paddingRight: 8}}>
                  <View testID="app-dialog-message">
                    <Markdown
                      markdownit={dialogMarkdown}
                      style={{
                        body: {color: colors.onSurfaceVariant, fontSize: 14},
                        bullet_list: {marginVertical: 4},
                        code_inline: {
                          backgroundColor: colors.surfaceContainerHighest,
                          color: colors.onSurface,
                        },
                        fence: {
                          backgroundColor: colors.surfaceContainerHighest,
                          borderColor: colors.outlineVariant,
                          color: colors.onSurface,
                        },
                        heading1: {
                          color: colors.onSurface,
                          fontSize: 20,
                          marginVertical: 8,
                        },
                        heading2: {
                          color: colors.onSurface,
                          fontSize: 18,
                          marginVertical: 7,
                        },
                        heading3: {
                          color: colors.onSurface,
                          fontSize: 16,
                          marginVertical: 6,
                        },
                        link: {color: colors.primary, textDecorationLine: 'underline'},
                        ordered_list: {marginVertical: 4},
                        paragraph: {marginBottom: 8, marginTop: 0},
                      }}>
                      {message}
                    </Markdown>
                  </View>
                </ScrollView>
              </RNHostView>
            ) : (
              <Column modifiers={[fillMaxWidth()]}>
                <Text
                  color={String(colors.onSurfaceVariant)}
                  style={{typography: 'bodyMedium'}}>
                  {message}
                </Text>
                {progress !== undefined && (
                  <LinearProgressIndicator
                    progress={progress}
                    color={colors.primary}
                    trackColor={colors.surfaceContainerHighest}
                    modifiers={[fillMaxWidth(), padding(0, 12, 0, 0)]}
                  />
                )}
              </Column>
            )}
          </AlertDialog.Text>
          {dismissAction ? (
            <AlertDialog.DismissButton>
              <TextButton
                {...({
                  testID: dismissAction.testID,
                  onPress: () => handleAction(dismissAction),
                } as any)}
                enabled={!dismissAction.disabled}
                onClick={() => handleAction(dismissAction)}
                colors={{contentColor: colors.onSurfaceVariant}}>
                <Text
                  color={String(colors.onSurfaceVariant)}
                  style={{typography: 'labelLarge', fontWeight: '700'}}>
                  {dismissAction.label}
                </Text>
              </TextButton>
            </AlertDialog.DismissButton>
          ) : null}
          {confirmAction ? (
            <AlertDialog.ConfirmButton>
              <TextButton
                {...({
                  testID: confirmAction.testID,
                  onPress: () => handleAction(confirmAction),
                } as any)}
                enabled={!confirmAction.disabled}
                onClick={() => handleAction(confirmAction)}
                colors={{
                  contentColor:
                    confirmAction.variant === 'destructive'
                      ? colors.error
                      : colors.primary,
                }}>
                <Text
                  color={String(
                    confirmAction.variant === 'destructive'
                      ? colors.error
                      : colors.primary,
                  )}
                  style={{typography: 'labelLarge', fontWeight: '700'}}>
                  {confirmAction.label}
                </Text>
              </TextButton>
            </AlertDialog.ConfirmButton>
          ) : null}
        </AlertDialog>
      </Host>
    </View>
  );
};

export default AppDialog;
