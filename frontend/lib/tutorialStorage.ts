import AsyncStorage from '@react-native-async-storage/async-storage';

const DONE_PREFIX = 'gm/tutorial_v1_done:';
const PENDING_KEY = 'gm/tutorial_pending_after_register';

function doneKey(accountKey: string): string {
  return `${DONE_PREFIX}${accountKey || 'anon'}`;
}

export async function isTutorialDone(accountKey: string): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(doneKey(accountKey));
    return v === '1';
  } catch {
    return false;
  }
}

export async function markTutorialDone(accountKey: string): Promise<void> {
  try {
    await AsyncStorage.setItem(doneKey(accountKey), '1');
    await AsyncStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** Po udanej rejestracji — pokaż tutorial przy pierwszym logowaniu. */
export async function markTutorialPendingAfterRegister(): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, '1');
  } catch {
    /* ignore */
  }
}

export async function consumeTutorialPending(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(PENDING_KEY);
    if (v !== '1') return false;
    await AsyncStorage.removeItem(PENDING_KEY);
    return true;
  } catch {
    return false;
  }
}
