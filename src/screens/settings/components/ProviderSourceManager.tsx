import {scheduleWhenIdle} from '../../../lib/performance/idleWork';
import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import {MaterialCommunityIcons, MaterialIcons} from '@expo/vector-icons';
import {
  extensionStorage,
  ProviderSource,
} from '../../../lib/storage/extensionStorage';
import {createProviderSource} from '../../../lib/utils/helpers';
import {
  normalizeSourceToken,
  sourceTokenStorage,
} from '../../../lib/storage/sourceTokenStorage';
import {
  clearPendingSourceToken,
  getPendingSourceToken,
} from '../../../lib/services/sourceIntent';
import {useM3Colors} from '../../../theme/M3PaletteContext';
import AppDialog from '../../../components/AppDialog';
import Text from '../../../components/ui/Text';
import {TVFocusable} from '../../../components/tv';
import {isTV} from '../../../lib/tv/constants';
import {AddSourceModal} from './AddSourceModal';
import {SourcePickerModal} from './SourcePickerModal';

const RAW_GITHUB_PREFIX = 'https://raw.githubusercontent.com/';
const INVALID_SOURCE_MESSAGE =
  'Enter a GitHub, Codeberg, Bitbucket or GitLab repo URL, an HTTP or HTTPS link to a manifest.json, or an author name such as author, author@cb, author@bb or author@gl.';

type Props = {
  primary: string;
  visible: boolean;
  onSourceChanged: (source: ProviderSource | undefined) => void | Promise<void>;
  // Source URL from the add source intent. Opens the add dialog prefilled.
  pendingSource?: string;
  pendingSourceRequestId?: number;
};

const ProviderSourceManager = ({
  primary,
  visible,
  onSourceChanged,
  pendingSource,
  pendingSourceRequestId,
}: Props) => {
  const colors = useM3Colors();
  const [sources, setSources] = useState<ProviderSource[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [invalidSourceMessage, setInvalidSourceMessage] = useState<string>();
  const [sourceToRemove, setSourceToRemove] = useState<string>();
  const [prefillValue, setPrefillValue] = useState<string>();
  const [prefillToken, setPrefillToken] = useState<string>();

  const defaultSource = useMemo(() => {
    return sources.find(item => item.isDefault) || sources[0];
  }, [sources]);

  const reloadSources = () => {
    const nextSources = extensionStorage.getProviderSources();
    setSources(nextSources);
    if (nextSources.length === 0) {
      setShowSourcePicker(false);
      setShowAddDialog(true);
    }
  };

  useEffect(() => {
    if (!visible) {
      return;
    }

    const currentSources = extensionStorage.getProviderSources();
    setSources(currentSources);

    if (currentSources.length === 0) {
      // Opening a native modal while the stack screen is attaching can lose
      // its Fabric surface on TV. Wait for the navigation transition to finish.
      return scheduleWhenIdle(() => setShowAddDialog(true), 300, true);
    }
  }, [visible]);

  useEffect(() => {
    if (!pendingSource) {
      return;
    }
    setShowSourcePicker(false);
    setPrefillValue(pendingSource);
    setPrefillToken(getPendingSourceToken(pendingSourceRequestId));
    setShowAddDialog(true);
  }, [pendingSource, pendingSourceRequestId]);

  const closeAddDialog = () => {
    setShowAddDialog(false);
    setPrefillValue(undefined);
    setPrefillToken(undefined);
    clearPendingSourceToken();
  };

  const handleSelectSource = async (source: ProviderSource) => {
    setShowSourcePicker(false);
    extensionStorage.setDefaultProviderSource(source.author);
    reloadSources();
    await onSourceChanged(extensionStorage.getProviderSource());
  };

  // token is undefined for a public source.
  const handleConfirmAdd = async (value: string, token?: string) => {
    try {
      const source = createProviderSource(value);
      if (token !== undefined) {
        const normalizedToken = normalizeSourceToken(token);
        if (!normalizedToken) {
          setInvalidSourceMessage('Enter a valid GitHub token.');
          return;
        }
        // GitHub raw files and custom HTTP/HTTPS sources take a token; the other
        // hosts use their own auth schemes.
        if (!source.url.startsWith(RAW_GITHUB_PREFIX) && !source.manifestUrl) {
          setInvalidSourceMessage(
            'Private sources are supported only on GitHub or a custom manifest URL.',
          );
          return;
        }
        sourceTokenStorage.set(source.author, normalizedToken);
      } else {
        sourceTokenStorage.delete(source.author);
      }
      extensionStorage.addProviderSources(
        source.author,
        source.url,
        source.manifestUrl,
      );
      extensionStorage.setDefaultProviderSource(source.author);
      closeAddDialog();
      reloadSources();
      await onSourceChanged(source);
    } catch {
      setInvalidSourceMessage(INVALID_SOURCE_MESSAGE);
    }
  };

  const confirmRemoveSource = async () => {
    if (!sourceToRemove) {
      return;
    }

    const targetAuthor = sourceToRemove;
    setSourceToRemove(undefined);

    const installed = extensionStorage.getInstalledProviders();
    const remainingInstalled = installed.filter(
      item => item.source?.author !== targetAuthor,
    );
    extensionStorage.setInstalledProviders(remainingInstalled);

    extensionStorage.removeProviderSource(targetAuthor);
    reloadSources();
    await onSourceChanged(extensionStorage.getProviderSource());
  };

  if (!visible) {
    return null;
  }

  return (
    <View className="px-5">
      <Text
        role="labelLarge"
        className="mb-2"
        style={{color: colors.onSurfaceVariant}}>
        Provider source
      </Text>
      <View className="flex-row items-stretch gap-2">
        {/* Active source selector card */}
        <View className="flex-1" style={{overflow: isTV ? 'visible' : 'hidden'}}>
          <TVFocusable
            accessibilityRole="button"
            accessibilityLabel="Select provider source"
            onPress={() => setShowSourcePicker(true)}
            borderRadius={20}
            focusScale={1.03}
            style={{
              height: 64,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              backgroundColor: colors.surfaceContainerHigh,
              borderColor: colors.outlineVariant,
              borderRadius: 20,
              borderWidth: 1,
            }}>
            <View
              className="h-10 w-10 items-center justify-center"
              style={{
                backgroundColor: '#171717',
                borderColor: colors.outlineVariant,
                borderRadius: 15,
                borderWidth: 1,
              }}>
              <MaterialCommunityIcons
                name="source-repository"
                size={20}
                color={colors.primary}
              />
            </View>
            <View className="ml-3 flex-1">
              <Text
                className="text-xs font-medium"
                style={{color: colors.onSurfaceVariant}}>
                Active source
              </Text>
              <Text
                className="mt-0.5 text-base font-bold"
                style={{
                  color: defaultSource
                    ? colors.onSurface
                    : colors.onSurfaceVariant,
                }}
                numberOfLines={1}>
                {defaultSource?.author || 'Add a provider source'}
              </Text>
            </View>
            <MaterialIcons
              name="expand-more"
              size={24}
              color={colors.onSurfaceVariant}
            />
          </TVFocusable>
        </View>

        {/* Plus button to add a source */}
        <TVFocusable
          accessibilityRole="button"
          accessibilityLabel="Add provider source"
          onPress={() => setShowAddDialog(true)}
          borderRadius={20}
          focusScale={1.08}
          style={{
            height: 64,
            width: 64,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#171717',
            // TV keeps a faint resting outline; focus adds its own border.
            borderColor: colors.outlineVariant,
            borderRadius: 20,
            borderWidth: isTV ? 1 : 0,
          }}>
          <MaterialCommunityIcons name="plus" size={28} color={primary} />
        </TVFocusable>
      </View>

      <SourcePickerModal
        visible={showSourcePicker}
        sources={sources}
        defaultSource={defaultSource}
        onDismiss={() => setShowSourcePicker(false)}
        onSelectSource={handleSelectSource}
        onRequestRemoveSource={author => setSourceToRemove(author)}
      />

      {showAddDialog && <AddSourceModal
        visible
        initialValue={prefillValue}
        initialToken={prefillToken}
        onClose={closeAddDialog}
        onAdd={handleConfirmAdd}
      />}

      <AppDialog
        visible={Boolean(invalidSourceMessage)}
        title="Invalid source"
        message={invalidSourceMessage || ''}
        primary={primary}
        variant="error"
        onDismiss={() => setInvalidSourceMessage(undefined)}
      />

      <AppDialog
        visible={Boolean(sourceToRemove)}
        title="Remove source?"
        message={`Remove ${sourceToRemove || 'this source'} from provider sources? Installed providers from it will also be removed.`}
        primary={primary}
        variant="warning"
        actions={[
          {label: 'Cancel'},
          {
            label: 'Remove',
            variant: 'destructive',
            onPress: confirmRemoveSource,
          },
        ]}
        onDismiss={() => setSourceToRemove(undefined)}
      />
    </View>
  );
};

export default ProviderSourceManager;
