/// <reference types="electron-vite/node" />

/** Build-time constants injected by CI (see .github/workflows/build.yml). */
interface ImportMetaEnv {
  /** The git tag the release was built from, e.g. "v1.2.0". Empty locally. */
  readonly MAIN_VITE_ORDINO_BUILD_REF?: string
}
