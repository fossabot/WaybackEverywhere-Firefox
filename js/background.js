/*******************************************************************************

    Wayback Everywhere - a browser addon/extension to redirect all pages to
    archive.org's Wayback Machine except the ones in Excludes List
    Copyright (C) 2018 Gokulakrishna K S

    his program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.

    Home: https://github.com/gkrishnaks
*/



//This is the  background script. It is responsible for actually redirecting requests,
//as well as   monitoring changes  in the redirects and the disabled status and reacting to them.
chrome.runtime.onInstalled.addListener(onInstalledfn);
chrome.runtime.onStartup.addListener(handleStartup);
const STORAGE = chrome.storage.local;


function log(msg) {
  if (log.enabled) {
    console.log('WaybackEverywhere: ' + msg);
  }
}
var appDisabled = false;
var tempExcludes = [];
var tempIncludes = [];


function onError(error) {
  log(error);
}

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  chrome.pageAction.show(tabId);


});
/*
chrome.pageAction.onClicked.addListener(function(tab) {

  chrome.pageAction.setPopup({
    tabId: tab.id,
    popup: "popup.html"
  });
});*/

chrome.tabs.onActivated.addListener(function(tab) {
  chrome.pageAction.show(tab.tabId);
});

const VERSION = "1.7.0";
log.enabled = false;
const jsonUrl = 'settings/setting.json';
var initialsettings;
var readworker = new Worker(chrome.extension.getURL('js/readData.js'));

function loadinitialdata(type) {
  var absUrl = chrome.extension.getURL(jsonUrl);
  readworker.postMessage([absUrl, 'json', type]);
};


readworker.onmessage = function(e) {
  initialsettings = e.data.workerResult.redirects;
  var isReset = e.data.type;
  log(JSON.stringify(initialsettings));
  STORAGE.set({
    redirects: initialsettings
  }, function() {
    if (isReset == 'doFullReset') {
      log('full reset completed, refrreshing tab to show changes');
      chrome.tabs.reload({
        bypassCache: true
      });
    }
  });
};

var addSitetoExclude = function(request, sender) {

  let redirectslist = [];
  log('addSitetoExclude request is ' + JSON.stringify(request));
  chrome.storage.local.get({
    redirects: []
  }, function(response) {
    for (let i = 0; i < response.redirects.length; i++) {
      redirectslist.push(response.redirects[i]);
    };
    let url1 = '';

    let tabid = '';
    let activetab = false;

    if (request.subtype == 'fromPopup') {
      tabid = request.tabid;
      url1 = request.url;
      activetab = true;

    } else {
      tabid = sender.tab.id;
      url1 = sender.tab.url;
    }


    log('tabid is..' + tabid);
    let obj = getHostfromUrl(url1);
    log(obj.hostname + ' and outputurl ' + obj.url + ' received from parseUrl.js for input Url ' + url1);

    //check if already exists in ExcludePattern
    let str = redirectslist[0].excludePattern;
    let array = str.split('*');
    if (array.indexOf(obj.hostname) < 0) {
      log('need to exclude this site' + obj.hostname + 'and previous exclude pattern is ' + redirectslist[0].excludePattern);
      redirectslist[0].excludePattern = redirectslist[0].excludePattern + '|*' + obj.hostname + '*';
      log('Now the new redirects is' + JSON.stringify(redirectslist));

      chrome.storage.local.set({
        redirects: redirectslist
      }, function(a) {
        log('Finished saving redirects to storage from url');
      });
    }


    // reload the page with excludedurl

    log('Need to reload page with excluded url.. ' + obj.url);
    chrome.tabs.update(tabid, {
      active: activetab,
      url: obj.url
    });
    // Check if it's a temporary exclude request and put in temp exclude list too
    if (request.category == 'AddtoTempExcludesList') {
      checkTempExcludes(obj.hostname);
    }
  });
};

function checkTempExcludes(domain) {
  // Check and add TempExcludes if Category is AddtoTempExcludesList
  log('Temp excludes before..' + tempExcludes);
  let temp = [];
  let isnew = true;
  let tempExc = tempExcludes;
  if (tempExc != null) {
    temp = tempExcludes.map(function(item, index) {
      item = item.replaceAll('*', '');
      item = item.replaceAll('|', '');
      return item;
    });
    if (temp.indexOf(domain) > -1) {
      isnew = false;
      log('already exists in tempexcludes, just calling addsitetoexclude without saving');
      return;
    }
  }
  if (isnew) {
    tempExc.push('|*' + domain + '*');
    log('does not exist in tempexcludes, saving to storage tempExcludes' + tempExc);

    STORAGE.set({
      tempExcludes: tempExc
    });
  }
}


//Redirects partitioned by request type, so we have to run through
//the minimum number of redirects for each request.
var partitionedRedirects = {};

//Cache of urls that have just been redirected to. They will not be redirected again, to
//stop recursive redirects, and endless redirect chains.
//Key is url, value is timestamp of redirect.
var ignoreNextRequest = {

};

//url => { timestamp:ms, count:1...n};
var justRedirected = {

};
var redirectThreshold = 3;


var counts = {
  archivedPageLoadsCount: 0,
  waybackSavescount: 0
};
var oldcounts = {
  archivedPageLoadsCount: 0,
  waybackSavescount: 0
};



function storeCountstoStorage() {

  var countsChanged = false;
  if (oldcounts.archivedPageLoadsCount < counts.archivedPageLoadsCount) {
    oldcounts.archivedPageLoadsCount = counts.archivedPageLoadsCount;
    countsChanged = true;
  }
  if (oldcounts.waybackSavescount < counts.waybackSavescount) {
    oldcounts.waybackSavescount = counts.waybackSavescount;
    countsChanged = true;

  }
  //  log(JSON.stringify(oldcounts));
  if (countsChanged) {
    STORAGE.set({
      counts: oldcounts
    });
  }

}

setInterval(storeCountstoStorage, 240000);
// 4 minutes once, write counts to disk
// Not a critical value, does not matter if user closes browser before an interval



//This is the actual function that gets called for each request and must
//decide whether or not we want to redirect.
function checkRedirects(details) {

  //We only allow GET request to be redirected, don't want to accidentally redirect
  //sensitive POST parameters
  if (details.method != 'GET') {
    return {};
  }
  // Once wayback redirect url is loaded, we can just return it..
  if (details.url.indexOf("web.archive.org/") > -1) {
    return {};
  }
  log(' Checking: ' + details.type + ': ' + details.url);

  var list = partitionedRedirects[details.type];
  log(list);
  if (!list) {
    log('No list for type: ' + details.type);
    return {};
  }

  var timestamp = ignoreNextRequest[details.url];
  if (timestamp) {
    log(' Ignoring ' + details.url + ', was just redirected ' +
      (new Date().getTime() - timestamp) + 'ms ago');
    delete ignoreNextRequest[details.url];
    return {};
  }

  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    log('calling getMatch with ..' + details.url);
    var result = r.getMatch(details.url);
    /* wmAvailabilityCheck( details.url,function onSuccess(wayback_url,url){
      log('wayback wmAvailabilityCheck passed ->  wayback_url = ' + wayback_url + ' url ' + url)
    },function onfail(){log(' wayback wmAvailabilityCheck failed')}); */
    log('getMatch result is.. result.isMatch -> ' + result.isMatch);
    if (result.isMatch) {

      //Check if we're stuck in a loop where we keep redirecting this, in that
      //case ignore!
      log(' checking if we have just redirected to avoid loop');
      var data = justRedirected[details.url];

      var threshold = 3000;
      if (!data || ((new Date().getTime() - data.timestamp) > threshold)) { //Obsolete after 3 seconds
        justRedirected[details.url] = {
          timestamp: new Date().getTime(),
          count: 1
        };
      } else {
        data.count++;
        justRedirected[details.url] = data;
        if (data.count >= redirectThreshold) {
          log(' Ignoring ' + details.url + ' because we have redirected it ' +
            data.count + ' times in the last ' + threshold + 'ms');
          return {};
        }
      }

      log(' Redirecting ' + details.url + ' ===> ' + result.redirectTo + ', type: ' + details.type + ', pattern: ' + r.includePattern);

      ignoreNextRequest[result.redirectTo] = new Date().getTime();
      /*var counts = {
        archivedPageLoadsCount: 0,
        waybackSavescount: 0
      };
      STORAGE.set({
        counts: counts
      });*/
      counts.archivedPageLoadsCount += 1;
      log(" redirectTo is......" + result.redirectTo);
      return {
        redirectUrl: result.redirectTo
      };
    }
  }

  return {};
}

//Monitor changes in data, and setup everything again.
//This could probably be optimized to not do everything on every change
//but why bother
function monitorChanges(changes, namespace) {
  log(' inside Monitorchanges');

  if (changes.disabled) {
    log('changes.disabled is ..' + JSON.stringify(changes.disabled));
    if (changes.disabled.newValue == true) {
      log('Disabling Wayback Everywhere, removing listener');
      appDisabled = true;
      chrome.webRequest.onBeforeRequest.removeListener(checkRedirects);
    } else {
      log('Enabling Wayback Everywhere, setting up listener');
      setUpRedirectListener();
      appDisabled = false;

    }
  }

  if (changes.redirects) {


    if (!appDisabled) {
      log('Wayback Everywhere Excludes list have changed, setting up listener again');
      setUpRedirectListener();
    }
  }

  if (changes.logging) {
    log('Logging settings have changed, updating...');
    updateLogging();
  }
  if (changes.tempIncludes) { // || changes.tempExcludes){
    log('tempIncludes changed. Assign to a variable which can be given to popup');
    tempIncludes = changes.tempIncludes.newValue;
    log(tempIncludes);
  }
  if (changes.tempExcludes) { // || changes.tempExcludes){
    log('tempIncludes changed. Assign to a variable which can be given to popup');
    tempExcludes = changes.tempExcludes.newValue;
    log(tempExcludes);
  }
}

//TODO: move Remove from Excludes from popup.js to here
// i.e Temporary incldue or Include should go here, currently it's in popup.js

chrome.storage.onChanged.addListener(monitorChanges);

//Creates a filter to pass to the listener so we don't have to run through
//all the redirects for all the request types we don't have any redirects for anyway.
function createFilter(redirects) {
  var types = [];
  for (var i = 0; i < redirects.length; i++) {
    redirects[i].appliesTo.forEach(function(type) {
      if (types.indexOf(type) == -1) {
        types.push(type);
      }
    });
  }

  types.sort();
  log(' createfilter is returning types as ' + types);
  return {
    urls: ['https://*/*', 'http://*/*'],
    types: types,
  };
}

function createPartitionedRedirects(redirects) {
  var partitioned = {};

  for (var i = 0; i < redirects.length; i++) {
    var redirect = new Redirect(redirects[i]);
    redirect.compile();
    for (var j = 0; j < redirect.appliesTo.length; j++) {
      var requestType = redirect.appliesTo[j];
      if (partitioned[requestType]) {
        partitioned[requestType].push(redirect);
      } else {
        partitioned[requestType] = [redirect];
      }
    }
  }

  log(' createPartitionedRedirects is returning.. ' + JSON.stringify(partitioned));
  return partitioned;
}

//Sets up the listener, partitions the redirects, creates the appropriate filters etc.
function setUpRedirectListener() {
  log(' in setUpRedirectListener ..');

  chrome.webRequest.onBeforeRequest.removeListener(checkRedirects); //Unsubscribe first, in case there are changes...

  chrome.storage.local.get({
    redirects: []
  }, function(obj) {
    var redirects = obj.redirects;
    if (redirects.length == 0) {
      log(' No redirects defined, not setting up listener');
      return;
    }

    partitionedRedirects = createPartitionedRedirects(redirects);
    var filter = createFilter(redirects);

    log(' Setting filter for listener: ' + JSON.stringify(filter) + 'checkRedirects function call with filter');
    chrome.webRequest.onBeforeRequest.addListener(checkRedirects, filter, ['blocking']);
  });
}


//Firefox doesn't allow the "content script" which is actually privileged
//to access the objects it gets from chrome.storage directly, so we
//proxy it through here
chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    log(' Received background message: ' + JSON.stringify(request));
    if (request.type == 'getredirects') {
      log('Getting redirects from storage');
      chrome.storage.local.get({
        redirects: []
      }, function(obj) {
        log('Got redirects from storage: ' + JSON.stringify(obj));
        sendResponse(obj);
      });
    } else if (request.type == 'saveredirects') {
      delete request.type;
      chrome.storage.local.set(request, function(a) {
        log('Finished saving redirects to storage from url');
        sendResponse({
          message: 'Redirects saved'
        });
      });

    } else if (request.type == 'excludethisSite') {
      delete request.type;
      if (appDisabled) {
        return;
      }
      addSitetoExclude(request, sender);
      sendResponse({
        message: 'site  excluded'
      });

    } else if (request.type == 'notify') {
      delete request.type;
      chrome.notifications.create({
        "type": "basic",
        "title": "Wayback Everywhere",
        "message": request.data
      });

    } else if (request.type == 'doFullReset') {
      var resettype = request.type;
      delete request.type;
      // loadinitialdata(() => {
      //   log('finished full  reset, returning response to setting page');
      //   sendResponse({
      //     message: ' Factory reset. Reloaded  settings from bundled json'
      //   });
      // });
      loadinitialdata(resettype);
    } else if (request.type == 'savetoWM') {
      delete request.type;
      if (appDisabled) {
        return;
      }
      savetoWM(request, sender, sendResponse);
    } else if (request.type == 'appDetails') {
      let a = JSON.stringify(counts);
      let c = {
        logstatus: log.enabled,
        counts: a,
        appDisabled: appDisabled,
        tempExcludes: tempExcludes,
        tempIncludes: tempIncludes
      };
      sendResponse(c);

    } else {
      log('Unexpected message: ' + JSON.stringify(request));
      return false;
    }

    return true; //This tells the browser to keep sendResponse alive because
    //we're sending the response asynchronously.
  });


//First time setup
//updateIcon();

function updateLogging() {
  chrome.storage.local.get({
    logging: false
  }, function(obj) {
    log.enabled = obj.logging;
    log('logging for Wayback Everywhere toggled to..' + log.enabled);
  });
}

updateLogging();

function savetoWM(request, sender, sendResponse) {
  var url1, tabid;
  var activetab = true;
  if (request.subtype == 'fromContent') {
    log('savetoWM message received from content script for ' + sender.tab.url + ' in tabid ' + sender.tab.id);
    url1 = sender.tab.url;
    tabid = sender.tab.id;
    activetab = false;

  }
  if (request.subtype == 'fromPopup') {
    log('savetoWM message received from popup.js for ' + request.url);
    tabid = request.tabid;
    url1 = request.url;
  }
  let wmSaveUrl;
  if (url1.indexOf('web.archive.org') > -1) {
    let obj = getHostfromUrl(url1);
    wmSaveUrl = 'https://web.archive.org/save/' + obj.url;
    log('call parseUrl.js getHostfromUrl with url as ' + url1 + ' received url back as ' + obj.url + ' and save url to be loaded is ' + wmSaveUrl);
  } else {
    wmSaveUrl = 'https://web.archive.org/save/' + url1;
  }
  chrome.tabs.update(tabid, {
    active: activetab,
    url: wmSaveUrl
  }, function(tab) {
    counts.waybackSavescount += 1;

    log('in success function of tab reload');
    sendResponse({
      message: 'saving page'
    });
  });
}

chrome.storage.local.get({
  disabled: false
}, function(obj) {
  if (!obj.disabled) {
    setUpRedirectListener();
  } else {
    log('Wayback Everywhere is disabled...' + obj.disabled);
  }
});

log(' Wayback Everywhere starting up...');

/*String.prototype.replaceAll = function(searchStr, replaceStr) {
  var str = this;

  // no match exists in string?
  if (str.indexOf(searchStr) === -1) {
    // return string
    return str;
  }

  // replace and remove first match, and do another recursirve search/replace
  return (str.replace(searchStr, replaceStr)).replaceAll(searchStr, replaceStr);
}*/
//set disabled to false upon startup

String.prototype.replaceAll = function(searchStr, replaceStr) {
  var str = this;

  // escape regexp special characters in search string
  searchStr = searchStr.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');

  return str.replace(new RegExp(searchStr, 'gi'), replaceStr);
};

function handleStartup() {
  STORAGE.get({
    counts: counts
  }, function(response) {
    counts.archivedPageLoadsCount = response.counts.archivedPageLoadsCount;
    counts.waybackSavescount = response.counts.waybackSavescount;
    oldcounts = JSON.parse(JSON.stringify(counts));
  });
  // Enable on startup - Popup button is "Temporarily disable.."
  // as user can do full disable from addon/extension page anyway
  STORAGE.set({
    disabled: false
  });
  // Disable logging on startup
  STORAGE.set({
    logging: false
  });
  // remove "temporarily exclude sites" on startup

  STORAGE.get({
    tempExcludes: []
  }, function(obj) {
    var excarray = obj.tempExcludes;
    log("exclude array on startup is..." + excarray);
    if (excarray.length > 0) {
      STORAGE.get({
        redirects: []
      }, function(response) {
        let redirects = response.redirects;
        for (let i = 0; i < excarray.length; i++) {
          let toReplace = excarray[i];
          log(toReplace + ' need to be removed from exclude pattern');
          redirects[0].excludePattern = redirects[0].excludePattern.replaceAll(toReplace, '');
        };
        log(JSON.stringify(redirects));
        let temp = [];
        STORAGE.set({
          redirects: redirects,
          tempExcludes: temp
        });
      });
    }
  });



  //add "temporary includes" back to Exclude Pattern on startup
  STORAGE.get({
    tempIncludes: []
  }, function(obj) {
    var incarray = obj.tempIncludes;
    log("include array on startup that need to be added back to Exclude pattern..." + incarray);
    if (incarray.length > 0) {
      STORAGE.get({
        redirects: []
      }, function(response) {
        let redirects = response.redirects;
        for (let i = 0; i < incarray.length; i++) {
          let toAdd = incarray[i];
          redirects[0].excludePattern = redirects[0].excludePattern + toAdd;
        };
        log(JSON.stringify(redirects));

        STORAGE.set({
          redirects: redirects
        });
        STORAGE.remove(
          "tempIncludes"
        );
      });
    }
  });
};


function onInstalledfn(details) {
  log(JSON.stringify(details));
  if ((details.reason == "install" || details.reason == "update") && details.temporary != true) {
    let url = chrome.extension.getURL('help.html');
    log("Wayback Everywhere addon installed or updated..");
    chrome.tabs.create({
      url: url
    });
  }

  if (details.reason == "install") {
    log(" Wayback Everywhere addon installed");

    let counts = {
      archivedPageLoadsCount: 0,
      waybackSavescount: 0
    };
    STORAGE.set({
      counts: counts
    });
    loadinitialdata('init');

    let tempExcludes = [];
    STORAGE.set({
      tempExcludes: tempExcludes
    });
    let tempIncludes = [];
    STORAGE.set({
      tempIncludes: tempIncludes
    });
  }

  if (details.reason == "update") {
    // if addon updated, just do a onstartup function once to set some values..
    handleStartup();
  }

}