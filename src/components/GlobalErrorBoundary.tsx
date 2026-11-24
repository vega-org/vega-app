import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Dimensions,
  Clipboard,
} from 'react-native';
import useThemeStore from '../lib/zustand/themeStore';
import TVTouchable from './tv/TVTouchable';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import {showAppDialog} from '../lib/zustand/appDialogStore';
import {getCrashlytics, isFirebaseNativeReady} from '../lib/utils/firebaseSafe';
import {hideBootSplash} from '../lib/utils/bootSplash';

interface GlobalErrorBoundaryProps {
  children: React.ReactNode;
}

interface GlobalErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showDetails: boolean;
}

export default class GlobalErrorBoundary extends React.Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  constructor(props: GlobalErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(
    error: Error,
  ): Partial<GlobalErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(' Global Error Boundary caught an error:', error);
    console.error('Error Info:', errorInfo);

    this.setState({
      errorInfo,
    });

    hideBootSplash().catch(() => {});

    // Log error details for debugging
    this.logErrorDetails(error, errorInfo);

    // Report to Crashlytics
    try {
      const hasFirebase =
        Boolean(Constants?.expoConfig?.extra?.hasFirebase) &&
        isFirebaseNativeReady();
      if (hasFirebase) {
        const crashlytics = getCrashlytics();
        crashlytics &&
          crashlytics().setAttributes({
            app_version: String(Application.nativeApplicationVersion || ''),
            build_version: String(Application.nativeBuildVersion || ''),
          });
        crashlytics && crashlytics().recordError(error);
      }
    } catch {}
  }

  logErrorDetails = (error: Error, errorInfo: React.ErrorInfo) => {
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      appVersion: Application.nativeApplicationVersion,
      buildVersion: Application.nativeBuildVersion,
    };

    console.log('📝 Error Details:', JSON.stringify(errorDetails, null, 2));
  };

  handleRestart = async () => {
    try {
      // Try to reload the app using Expo Updates
      if (Updates.isEnabled) {
        await Updates.reloadAsync();
      } else {
        // Fallback: reset the error boundary state
        this.resetError();
      }
    } catch (reloadError) {
      console.error('Failed to reload app:', reloadError);
      this.resetError();
    }
  };

  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  showErrorReport = () => {
    const {error, errorInfo} = this.state;
    if (!error) {
      return;
    }

    const errorReport = `
App Version: ${Application.nativeApplicationVersion}
Build: ${Application.nativeBuildVersion}
Time: ${new Date().toLocaleString()}

Error: ${error.message}

Stack Trace:
${error.stack}

Component Stack:
${errorInfo?.componentStack || 'Not available'}
    `;

    showAppDialog({
      title: 'Error Report',
      message:
        'Error details have been logged to console. You can copy this information for support.',
      variant: 'error',
      actions: [
        {
          label: 'Copy report',
          onPress: () => Clipboard.setString(errorReport),
        },
        {label: 'OK', variant: 'primary'},
      ],
    });
  };

  toggleDetails = () => {
    this.setState(prevState => ({
      showDetails: !prevState.showDetails,
    }));
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return (
        <ErrorFallbackUI
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          showDetails={this.state.showDetails}
          onRestart={this.handleRestart}
          onReset={this.resetError}
          onToggleDetails={this.toggleDetails}
          onShowReport={this.showErrorReport}
        />
      );
    }

    return this.props.children;
  }
}

interface ErrorFallbackUIProps {
  error: Error;
  errorInfo: React.ErrorInfo | null;
  showDetails: boolean;
  onRestart: () => void;
  onReset: () => void;
  onToggleDetails: () => void;
  onShowReport: () => void;
}

const ErrorFallbackUI: React.FC<ErrorFallbackUIProps> = ({
  error,
  errorInfo,
  showDetails,
  onRestart,
  onReset,
  onToggleDetails,
  onShowReport,
}) => {
  const {primary} = useThemeStore();
  const {width} = Dimensions.get('window');
  const isTablet = width > 768;

  return (
    <View className="flex-1 bg-black">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: isTablet ? 32 : 16,
          minHeight: '100%',
          justifyContent: 'center',
        }}>
        <View className="items-center mb-8">
          <View
            className="w-20 h-20 rounded-full items-center justify-center mb-4"
            style={{backgroundColor: `${primary}20`}}>
            <Ionicons name="warning" size={40} color="#ef4444" />
          </View>

          <Text className="text-white text-2xl font-bold text-center mb-2">
            Oops! Something went wrong
          </Text>

          <Text className="text-gray-400 text-base text-center leading-6">
            The app encountered an unexpected error and needs to restart.
          </Text>
        </View>

        <View className="bg-gray-900 rounded-lg p-4 mb-6">
          <Text className="text-red-400 text-sm font-medium mb-2">
            Error Details:
          </Text>
          <Text className="text-gray-300 text-sm">
            {error.message || 'Unknown error occurred'}
          </Text>
        </View>

        {showDetails && (
          <View className="bg-gray-900 rounded-lg p-4 mb-6">
            <Text className="text-orange-400 text-sm font-medium mb-2">
              Technical Details:
            </Text>
            <ScrollView className="max-h-32">
              <Text className="text-gray-400 text-xs font-mono">
                {error.stack}
              </Text>
              {errorInfo?.componentStack && (
                <Text className="text-gray-500 text-xs font-mono mt-2">
                  Component Stack:{'\n'}
                  {errorInfo.componentStack}
                </Text>
              )}
            </ScrollView>
          </View>
        )}

        <View className="space-y-3">
          <TVTouchable
            hasTVPreferredFocus
            onPress={onRestart}
            className="bg-red-600 rounded-lg py-4 px-6 items-center"
            activeOpacity={0.8}>
            <View className="flex-row items-center">
              <Ionicons name="refresh" size={20} color="white" />
              <Text className="text-white font-semibold text-base ml-2">
                Restart App
              </Text>
            </View>
          </TVTouchable>

          <TVTouchable
            onPress={onReset}
            className="rounded-lg py-4 px-6 items-center border border-gray-600"
            style={{backgroundColor: `${primary}20`}}
            activeOpacity={0.8}>
            <View className="flex-row items-center">
              <Ionicons name="arrow-back" size={20} color={primary} />
              <Text
                className="font-semibold text-base ml-2"
                style={{color: primary}}>
                Try Again
              </Text>
            </View>
          </TVTouchable>

          <View className="flex-row space-x-3">
            <TVTouchable
              onPress={onToggleDetails}
              className="flex-1 bg-gray-800 rounded-lg py-3 px-4 items-center"
              activeOpacity={0.8}>
              <View className="flex-row items-center">
                <Ionicons
                  name={showDetails ? 'eye-off' : 'eye'}
                  size={16}
                  color="#9ca3af"
                />
                <Text className="text-gray-400 text-sm ml-2">
                  {showDetails ? 'Hide' : 'Show'} Details
                </Text>
              </View>
            </TVTouchable>

            <TVTouchable
              onPress={onShowReport}
              className="flex-1 bg-gray-800 rounded-lg py-3 px-4 items-center"
              activeOpacity={0.8}>
              <View className="flex-row items-center">
                <Ionicons name="bug" size={16} color="#9ca3af" />
                <Text className="text-gray-400 text-sm ml-2">Report</Text>
              </View>
            </TVTouchable>
          </View>
        </View>

        <View className="mt-8 pt-6 border-t border-gray-800">
          <Text className="text-gray-500 text-xs text-center">
            App Version: {Application.nativeApplicationVersion} (
            {Application.nativeBuildVersion})
          </Text>
          <Text className="text-gray-600 text-xs text-center mt-1">
            If this keeps happening, report on github or discord
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};
