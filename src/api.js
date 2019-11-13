/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { Log } = ChromeUtils.import("resource://gre/modules/Log.jsm");
const { Weave } = ChromeUtils.import("resource://services-sync/main.js");
const { Svc } = ChromeUtils.import("resource://services-sync/util.js");
const { fxAccounts } = ChromeUtils.import("resource://gre/modules/FxAccounts.jsm");
const { FxAccountsClient } = ChromeUtils.import("resource://gre/modules/FxAccountsClient.jsm");
const { FxAccountsConfig } = ChromeUtils.import("resource://gre/modules/FxAccountsConfig.jsm");


const HOST_PREF = "identity.fxaccounts.auth.uri";
const OAUTH_HOST_PREF = "identity.fxaccounts.remote.oauth.uri";
const TOKEN_HOST_PREF = "identity.sync.tokenserver.uri";
const PROFILE_HOST_PREF = "identity.fxaccounts.remote.profile.uri";

Services.prefs.setCharPref(HOST_PREF, "https://api-accounts.stage.mozaws.net/v1");
Services.prefs.setCharPref(OAUTH_HOST_PREF, "https://oauth.stage.mozaws.net/v1");
Services.prefs.setCharPref(TOKEN_HOST_PREF, "https://token.stage.mozaws.net/1.0/sync/1.5");
Services.prefs.setCharPref(PROFILE_HOST_PREF, "https://profile.stage.mozaws.net/v1");

function printServersSetup() {
  console.log("identity.fxaccounts.auth.uri " + Services.prefs.getCharPref("identity.fxaccounts.auth.uri"));
  console.log("identity.fxaccounts.remote.oauth.uri " + Services.prefs.getCharPref("identity.fxaccounts.remote.oauth.uri"));
  console.log("identity.sync.tokenserver.uri " + Services.prefs.getCharPref("identity.sync.tokenserver.uri"));
  console.log("identity.fxaccounts.remote.profile.uri " + Services.prefs.getCharPref("identity.fxaccounts.remote.profile.uri"));
};


function promiseObserver(aEventName) {
  console.log("wait for " + aEventName);
  return new Promise(resolve => {
    let handler = () => {
      Svc.Obs.remove(aEventName, handler);
      resolve();
    };
    Svc.Obs.add(aEventName, handler);
  });
};


async function condProfStartup() {
  printServersSetup();

  // Delay autosync
  Weave.Svc.Prefs.set("scheduler.immediateInterval", 7200);
  Weave.Svc.Prefs.set("scheduler.idleInterval", 7200);
  Weave.Svc.Prefs.set("scheduler.activeInterval", 7200);
  Weave.Svc.Prefs.set("syncThreshold", 10000000);

  return;

  // we want to do a first sync.
  Weave.Svc.Prefs.set("firstSync", true);

  var env = Cc["@mozilla.org/process/environment;1"].getService(
    Ci.nsIEnvironment
  );
  var username = env.get("CONDPROF_USERNAME");
  var password = env.get("CONDPROF_PASSWORD");

  console.log("User is " + username);
  // connect to FxA if needed
  var user = await fxAccounts.getSignedInUser();
  if (!user) {
    console.log("Signing in to FxA");
    var fxAccount = {username: username, "password": password};
    await FxAccountsConfig.ensureConfigured();
    let client = new FxAccountsClient();
    let credentials = await client.signIn(fxAccount.username, fxAccount.password, true);
    await fxAccounts._internal.setSignedInUser(credentials);
    if (!credentials.verified) {
      throw new Error("account not verified!");
    }
  } else {
    console.log("FxA already connected");
  }

  // configure sync
  await Weave.Service.configure();

  if (!Weave.Status.ready) {
    await promiseObserver("weave:service:ready");
  }

  if (Weave.Service.locked) {
    await promiseObserver("weave:service:resyncs-finished");
  }

  console.log("Now triggering a sync -- this will also login via the token server");
  await Weave.Service.sync();
  console.log("Sync done");
}


this.condprof = class extends ExtensionAPI {
  onStartup() {
    condProfStartup();
  }
  onShutdown(isAppShutdown) {}

  getAPI(context) {
    const {extension} = context;
    return {
        condprof: {
          async testAPI() {
            console.log("YAY");
          },
      },
    };
  }
};
