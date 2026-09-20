"use client";

type PickerResult = { action: string; docs?: { id?: string }[] };
type PickerInstance = { setVisible(visible: boolean): void; dispose(): void };
type DocsView = { setMimeTypes(types: string): DocsView; setMode(mode: string): DocsView };
type PickerBuilder = {
  addView(view: DocsView): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(callback: (result: PickerResult) => void): PickerBuilder;
  build(): PickerInstance;
};
type PickerApi = {
  DocsView: new (view: string) => DocsView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { SPREADSHEETS: string };
  DocsViewMode: { LIST: string };
  Action: { PICKED: string; CANCEL: string };
};
type GoogleWindow = Window & {
  gapi?: { load(name: string, options: { callback(): void; onerror(): void; timeout: number; ontimeout(): void }): void };
  google?: { picker?: PickerApi };
};

let pickerReady: Promise<PickerApi> | undefined;

function loadPicker(): Promise<PickerApi> {
  if (pickerReady) return pickerReady;
  const host = window as GoogleWindow;
  pickerReady = new Promise<PickerApi>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(fail, 20_000);
    let settled = false;
    function fail() {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script.remove();
      reject(new Error("Google's file chooser couldn't load. Check your connection or browser blockers and try again."));
    }
    function ready() {
      if (settled) return;
      const api = host.google?.picker;
      if (!api) return fail();
      settled = true;
      window.clearTimeout(timer);
      resolve(api);
    }
    function loadModule() {
      if (settled) return;
      if (!host.gapi) return fail();
      host.gapi.load("picker", { callback: ready, onerror: fail, timeout: 15_000, ontimeout: fail });
    }
    if (host.google?.picker) ready();
    else if (host.gapi) loadModule();
    else {
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.onload = loadModule;
      script.onerror = fail;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    pickerReady = undefined;
    throw error;
  });
  return pickerReady;
}

export async function choosePlanner(config: { accessToken: string; apiKey: string; appId: string }): Promise<string | null> {
  const api = await loadPicker();
  return new Promise((resolve, reject) => {
    const view = new api.DocsView(api.ViewId.SPREADSHEETS)
      .setMimeTypes("application/vnd.google-apps.spreadsheet")
      .setMode(api.DocsViewMode.LIST);
    const picker: PickerInstance = new api.PickerBuilder()
      .setAppId(config.appId)
      .setDeveloperKey(config.apiKey)
      .setOAuthToken(config.accessToken)
      .setOrigin(window.location.origin)
      .setTitle("Choose your Excela planner")
      .addView(view)
      .setCallback((result) => {
        if (result.action === api.Action.PICKED) {
          picker.dispose();
          const id = result.docs?.[0]?.id;
          if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) reject(new Error("Google did not return a valid spreadsheet. Please choose it again."));
          else resolve(`https://docs.google.com/spreadsheets/d/${id}/edit`);
        } else if (result.action === api.Action.CANCEL) {
          picker.dispose();
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}
