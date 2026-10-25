import { registerPlugin } from "@capacitor/core";

// One shared registration avoids Capacitor's "plugin already registered" warning
// when both runtime restart and back-navigation modules load.
export const AppNavigation = registerPlugin("AppNavigation");
