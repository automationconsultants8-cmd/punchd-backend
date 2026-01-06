// =============================================
// FILE: src/services/notifications.js
// Mobile push notification service
// =============================================

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Get the Expo push token
export async function registerForPushNotifications() {
  let token = null;

  // Must be a physical device (not simulator) for push notifications
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permissions if not granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission denied');
    return null;
  }

  // Get the Expo push token
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: 'your-project-id', // Replace with your Expo project ID
    });
    token = tokenData.data;
    console.log('Expo push token:', token);
  } catch (error) {
    console.error('Error getting push token:', error);
    return null;
  }

  // Android-specific channel setup
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#C9A227', // Gold color
    });
  }

  return token;
}

// Register token with backend
export async function registerTokenWithBackend(token) {
  try {
    const authToken = await AsyncStorage.getItem('authToken');
    if (!authToken) {
      console.log('No auth token, skipping push registration');
      return false;
    }

    await api.post(
      '/api/notifications/register-token',
      {
        token,
        platform: Platform.OS,
      },
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );

    // Store token locally so we can unregister it later
    await AsyncStorage.setItem('pushToken', token);
    console.log('Push token registered with backend');
    return true;
  } catch (error) {
    console.error('Error registering push token:', error);
    return false;
  }
}

// Unregister token from backend (call on logout)
export async function unregisterTokenFromBackend() {
  try {
    const authToken = await AsyncStorage.getItem('authToken');
    const pushToken = await AsyncStorage.getItem('pushToken');

    if (!authToken || !pushToken) {
      return;
    }

    await api.delete('/api/notifications/unregister-token', {
      headers: { Authorization: `Bearer ${authToken}` },
      data: { token: pushToken },
    });

    await AsyncStorage.removeItem('pushToken');
    console.log('Push token unregistered');
  } catch (error) {
    console.error('Error unregistering push token:', error);
  }
}

// Full setup: get permission, get token, register with backend
export async function setupPushNotifications() {
  const token = await registerForPushNotifications();
  if (token) {
    await registerTokenWithBackend(token);
  }
  return token;
}

// Add notification listeners
export function addNotificationListeners(navigation) {
  // Handle notification when app is in foreground
  const foregroundSubscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      console.log('Notification received:', notification);
    }
  );

  // Handle notification tap (when user taps the notification)
  const responseSubscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data;
      console.log('Notification tapped:', data);

      // Navigate based on notification type
      if (data?.screen && navigation) {
        navigation.navigate(data.screen);
      }
    }
  );

  // Return cleanup function
  return () => {
    foregroundSubscription.remove();
    responseSubscription.remove();
  };
}

// Get the badge count
export async function getBadgeCount() {
  return await Notifications.getBadgeCountAsync();
}

// Set the badge count
export async function setBadgeCount(count) {
  await Notifications.setBadgeCountAsync(count);
}

// Clear all notifications
export async function clearAllNotifications() {
  await Notifications.dismissAllNotificationsAsync();
  await setBadgeCount(0);
}
