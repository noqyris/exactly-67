import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.noqyris.exactly67',
  appName: 'Exactly 67',
  webDir: 'dist',
  // Match the game background so there is no white flash while the web view loads.
  backgroundColor: '#F6EEDF',
  ios: {
    contentInset: 'never',
  },
  plugins: {
    LocalNotifications: {
      // iOS: a reminder that comes due while the game is open stays silent —
      // the player is already here. (Nothing is lost: they are all "come back" nudges.)
      presentationOptions: [],
      // Android: the status-bar icon tint (the game's ink colour).
      iconColor: '#2B2440',
    },
  },
}

export default config
