// Whether the build switched Daily Three on (F12). VITE_DAILY_THREE is
// normalised to exactly "1" or "" at build time (buildEnv.ts). The header and
// home page read it here, apart from lib/dailyData.ts, so they import nothing
// else from Daily Three. App.tsx tests the variable inline instead, so a build
// without the flag emits no /daily page code.

export const DAILY_THREE = import.meta.env.VITE_DAILY_THREE === "1";
