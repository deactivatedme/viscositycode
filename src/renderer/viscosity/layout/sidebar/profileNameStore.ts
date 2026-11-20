/**
 * ViscosityCode: the profile row name the viewer typed, remembered per device
 * in localStorage (`viscosity:profile-name:v1`, the plain name). A view
 * preference: it never reaches the host, a provider or a log. Absent means the
 * default from `profileIdentity.ts`.
 */
import { create } from "zustand";
import { cleanProfileName } from "./profileIdentity";

export const PROFILE_NAME_STORAGE_KEY = "viscosity:profile-name:v1";

/** The remembered name, or null when absent, blank, or storage is blocked. */
export function readStoredProfileName(): string | null {
  try {
    return cleanProfileName(localStorage.getItem(PROFILE_NAME_STORAGE_KEY));
  } catch {
    return null;
  }
}

interface ProfileNameState {
  /** The typed name, or null to show the default. */
  name: string | null;
  /** Remembers a name; a blank one forgets it, which returns to the default. */
  setName: (value: string) => void;
}

export const useProfileNameStore = create<ProfileNameState>()((set) => ({
  name: readStoredProfileName(),
  setName: (value) => {
    const name = cleanProfileName(value);
    set({ name });
    try {
      if (name) localStorage.setItem(PROFILE_NAME_STORAGE_KEY, name);
      else localStorage.removeItem(PROFILE_NAME_STORAGE_KEY);
    } catch {
      // Best-effort view preference (private mode, quota, blocked site data).
    }
  },
}));
