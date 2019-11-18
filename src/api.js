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
const { LogManager } = ChromeUtils.import("resource://services-common/logmanager.js");

const HOST_PREF = "identity.fxaccounts.auth.uri";
const OAUTH_HOST_PREF = "identity.fxaccounts.remote.oauth.uri";
const TOKEN_HOST_PREF = "identity.sync.tokenserver.uri";
const PROFILE_HOST_PREF = "identity.fxaccounts.remote.profile.uri";
const USERNAME = "condprof@restmail.net";


// UI https://accounts.stage.mozaws.net/
Services.prefs.setCharPref(HOST_PREF, "https://api-accounts.stage.mozaws.net/v1");
Services.prefs.setCharPref(OAUTH_HOST_PREF, "https://oauth.stage.mozaws.net/v1");
Services.prefs.setCharPref(TOKEN_HOST_PREF, "https://token.stage.mozaws.net/1.0/sync/1.5");
Services.prefs.setCharPref(PROFILE_HOST_PREF, "https://profile.stage.mozaws.net/v1");


var Logger = {
  _foStream: null,
  _converter: null,
  _potentialError: null,

  init(path) {
    if (this._converter != null) {
      // we're already open!
      return;
    }

    if (path) {
      Services.prefs.setCharPref("tps.logfile", path);
    } else {
      path = Services.prefs.getCharPref("tps.logfile");
    }

    this._file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    this._file.initWithPath(path);
    var exists = this._file.exists();

    // Make a file output stream and converter to handle it.
    this._foStream = Cc[
      "@mozilla.org/network/file-output-stream;1"
    ].createInstance(Ci.nsIFileOutputStream);
    // If the file already exists, append it, otherwise create it.
    var fileflags = exists ? 0x02 | 0x08 | 0x10 : 0x02 | 0x08 | 0x20;

    this._foStream.init(this._file, fileflags, 0o666, 0);
    this._converter = Cc[
      "@mozilla.org/intl/converter-output-stream;1"
    ].createInstance(Ci.nsIConverterOutputStream);
    this._converter.init(this._foStream, "UTF-8");
  },

  write(data) {
    if (this._converter == null) {
      Cu.reportError("TPS Logger.write called with _converter == null!");
      return;
    }
    this._converter.writeString(data);
  },

  close() {
    if (this._converter != null) {
      this._converter.close();
      this._converter = null;
      this._foStream = null;
    }
  },

  AssertTrue(bool, msg, showPotentialError) {
    if (bool) {
      return;
    }

    if (showPotentialError && this._potentialError) {
      msg += "; " + this._potentialError;
      this._potentialError = null;
    }
    throw new Error("ASSERTION FAILED! " + msg);
  },

  AssertFalse(bool, msg, showPotentialError) {
    return this.AssertTrue(!bool, msg, showPotentialError);
  },

  AssertEqual(val1, val2, msg) {
    if (val1 != val2) {
      throw new Error(
        "ASSERTION FAILED! " +
          msg +
          "; expected " +
          JSON.stringify(val2) +
          ", got " +
          JSON.stringify(val1)
      );
    }
  },

  log(msg, withoutPrefix) {
    dump(msg + "\n");
    if (withoutPrefix) {
      this.write(msg + "\n");
    } else {
      function pad(n, len) {
        let s = "0000" + n;
        return s.slice(-len);
      }

      let now = new Date();
      let year = pad(now.getFullYear(), 4);
      let month = pad(now.getMonth() + 1, 2);
      let day = pad(now.getDate(), 2);
      let hour = pad(now.getHours(), 2);
      let minutes = pad(now.getMinutes(), 2);
      let seconds = pad(now.getSeconds(), 2);
      let ms = pad(now.getMilliseconds(), 3);

      this.write(
        year +
          "-" +
          month +
          "-" +
          day +
          " " +
          hour +
          ":" +
          minutes +
          ":" +
          seconds +
          "." +
          ms +
          " " +
          msg +
          "\n"
      );
    }
  },

  clearPotentialError() {
    this._potentialError = null;
  },

  logPotentialError(msg) {
    this._potentialError = msg;
  },

  logLastPotentialError(msg) {
    var message = msg;
    if (this._potentialError) {
      message = this._poentialError;
      this._potentialError = null;
    }
    this.log("CROSSWEAVE ERROR: " + message);
  },

  logError(msg) {
    this.log("CROSSWEAVE ERROR: " + msg);
  },

  logInfo(msg, withoutPrefix) {
    if (withoutPrefix) {
      this.log(msg, true);
    } else {
      this.log("CROSSWEAVE INFO: " + msg);
    }
  },

  logPass(msg) {
    this.log("CROSSWEAVE TEST PASS: " + msg);
  },
};


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
  Weave.Svc.Prefs.set("scheduler.immediateInterval", 7200);
  Weave.Svc.Prefs.set("scheduler.idleInterval", 7200);
  Weave.Svc.Prefs.set("scheduler.activeInterval", 7200);
  Weave.Svc.Prefs.set("syncThreshold", 10000000);
}


// From TPS -
var Authentication = {
  async isLoggedIn() {
    return !!(await this.getSignedInUser());
  },

  async isReady() {
    let user = await this.getSignedInUser();
    return user && user.verified;
  },

  async getSignedInUser() {
      try {
        return await fxAccounts.getSignedInUser();
      } catch (error) {
        Logger.logError(
          "getSignedInUser() failed with: " + JSON.stringify(error)
        );
        throw error;
      }
    },

  async shortWaitForVerification(ms) {
    let userData = await this.getSignedInUser();
    let timeoutID;
    let timeoutPromise = new Promise(resolve => {
      timeoutID = setTimeout(() => {
        Logger.logInfo(`Warning: no verification after ${ms}ms.`);
        resolve();
      }, ms);
    });
    await Promise.race([
      fxAccounts.whenVerified(userData).finally(() => clearTimeout(timeoutID)),
      timeoutPromise,
    ]);
    userData = await this.getSignedInUser();
    return userData && userData.verified;
  },

  async _openVerificationPage(uri) {
    let mainWindow = Services.wm.getMostRecentWindow("navigator:browser");
    let newtab = mainWindow.gBrowser.addWebTab(uri);
    let win = mainWindow.gBrowser.getBrowserForTab(newtab);
    await new Promise(resolve => {
      win.addEventListener("loadend", resolve, { once: true });
    });
    let didVerify = await this.shortWaitForVerification(10000);
    mainWindow.gBrowser.removeTab(newtab);
    return didVerify;
  },

  async _completeVerification() {
    Logger.logInfo("Fetching mail (from restmail) for user " + USERNAME);
    let restmailURI = `https://www.restmail.net/mail/${encodeURIComponent(
      USERNAME
    )}`;
    let triedAlready = new Set();
    const tries = 10;
    const normalWait = 2000;
    for (let i = 0; i < tries; ++i) {
      let resp = await fetch(restmailURI);
      let messages = await resp.json();
      // Sort so that the most recent emails are first.
      messages.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
      for (let m of messages) {
        // We look for a link that has a x-link that we haven't yet tried.
        if (!m.headers["x-link"] || triedAlready.has(m.headers["x-link"])) {
          continue;
        }
        let confirmLink = m.headers["x-link"];
        triedAlready.add(confirmLink);
        Logger.logInfo("Trying confirmation link " + confirmLink);
        try {
          if (await this._openVerificationPage(confirmLink)) {
            return true;
          }
        } catch (e) {
          Logger.logInfo(
            "Warning: Failed to follow confirmation link: " +
              Log.exceptionStr(e)
          );
        }
      }
      if (i === 0) {
        // first time through after failing we'll do this.
        await fxAccounts.resendVerificationEmail();
      }
      if (await this.shortWaitForVerification(normalWait)) {
        return true;
      }
    }
    // One last try.
    return this.shortWaitForVerification(normalWait);
  },

  async signIn(password) {
    Logger.logInfo("Login user: " + USERNAME);

    try {
      // Required here since we don't go through the real login page
      await FxAccountsConfig.ensureConfigured();

      let client = new FxAccountsClient();
      let credentials = await client.signIn(
        USERNAME,
        password,
        true
      );
      await fxAccounts._internal.setSignedInUser(credentials);
      if (!credentials.verified) {
        await this._completeVerification();
      }

      return true;
    } catch (error) {
      throw new Error("signIn() failed with: " + error.message);
    }
  },

  async signOut() {
    if (await Authentication.isLoggedIn()) {
      // Note: This will clean up the device ID.
      await fxAccounts.signOut();
    }
  },
}


this.condprof = class extends ExtensionAPI {
  onStartup() {
    let win = Services.wm.getMostRecentWindow("navigator:browser");
    // manually expose condprof APIs
    win.condprof = this.getAPI(this);

    Svc.Obs.add("weave:service:sync:error", this);
    condProfStartup();
  }
  onShutdown(isAppShutdown) {
  }

  observe(subject, topic, data) {
    console.log(subject, topic, data);
  }

  getAPI(context) {
    const {extension} = context;
    return {
          async signIn(password) {
            return await Authentication.signIn(password);
          },
          async configureSync() {
           Logger.AssertTrue(await Authentication.isReady());
           await Weave.Service.configure();
           if (!Weave.Status.ready) {
             await promiseObserver("weave:service:ready");
           }
           if (Weave.Service.locked) {
             await promiseObserver("weave:service:resyncs-finished");
           }
           Weave.Svc.Prefs.set("firstSync", "resetClient");
           // todo, enable all sync engines here
           // the addon engine requires kinto creds...
         },
         async triggerSync() {
           await this.configureSync();
           console.log("Now triggering a sync -- this will also login via the token server");
           await Weave.Service.sync();
           // XXX grab the sync done event and await for it here..
           console.log("Sync done");
         },
         getLog() {
           // todo, grab logs
           return {"some logs": "here"};
         }
    };
  }
};
