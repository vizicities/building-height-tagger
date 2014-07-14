// Init overpass
overpass.init();

var settings = {
  osmUser: "",
  osmPass: "",
  osmURL: "http://api.openstreetmap.org",
  heightToEyes: 1.6,
  heightToFloor: 0,
  code:{},
  server: "http://overpass-api.de/api/",
  // tileServer: "http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  tileServer: "http://otile1.mqcdn.com/tiles/1.0.0/map/{z}/{x}/{y}.jpg",
  force_simple_cors_request: true,
  disable_poiomatic: true,
};

var configs = {
  appname: "overpass-ide-map",
};

var disableFeatureInteraction = false;

var splash = document.getElementById("splash");

var successNotification = document.querySelector(".notifications").querySelector(".alert-success");
var failureNotification = document.querySelector(".notifications").querySelector(".alert-failure");

// No idea why I need to do this manually instead of Ratchet doing it
var settingsDOM = document.getElementById("settings");
var settingsOpenButton = document.getElementById("settings-open");
var settingsCloseButton = document.getElementById("settings-close");
var settingsSaveButton = document.getElementById("settings-save");

var settingsOSMUsername = document.getElementById("settings-osm-username");
var settingsOSMPassword = document.getElementById("settings-osm-password");
var settingsHeight = document.getElementById("settings-height");
var settingsFloorHeight = document.getElementById("settings-floor-height");

settingsOpenButton.addEventListener("click", function() {
  settingsOSMUsername.value = settings.osmUser;
  settingsOSMPassword.value = settings.osmPass;
  settingsHeight.value = settings.heightToEyes;
  settingsFloorHeight.value = settings.heightToFloor;

  settingsDOM.classList.add("active");
});

settingsCloseButton.addEventListener("click", function() {
  settingsDOM.classList.remove("active");
});

settingsSaveButton.addEventListener("click", function() {
  settings.osmUser = settingsOSMUsername.value;
  settings.osmPass = settingsOSMPassword.value;
  settings.heightToEyes = Number(settingsHeight.value);
  settings.heightToFloor = Number(settingsFloorHeight.value);

  localforage.setItem("settings", settings).then(function() {
    console.log("Saved settings");
    settingsDOM.classList.remove("active");
  });
});

var initMap = function() {
  // init leaflet
  ide.map = new L.Map("map");

  var tilesUrl = settings.tileServer;
  var tilesAttrib = '&copy; <a href="www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var tiles = new L.TileLayer(tilesUrl,{attribution:tilesAttrib});

  // ide.map.setView([51.50358, -0.01924], 16).addLayer(tiles);
  ide.map.locate({setView: true, maxZoom: 15}).addLayer(tiles);

  scaleControl = new L.Control.Scale({metric:true,imperial:false});
  scaleControl.addTo(ide.map);

  ide.map.on("layeradd", function(e) {
    if (!(e.layer instanceof L.GeoJSON)) return;
    // ide.map.setView([0,0],18,true);
    // ide.map.fitBounds(e.layer.getBounds() );
  });

  ide.map.on('load', function() {
    // Request data
    var query = "[out:json];((way({s},{w},{n},{e})['building'];);(._;node(w);););out;";

    var bounds = ide.map.getBounds();
    var parameters = {
      s: bounds._southWest.lat,
      w: bounds._southWest.lng,
      n: bounds._northEast.lat,
      e: bounds._northEast.lng
    };

    // Replace URL placeholders with parameter values
    query = query.replace(/\{([swne])\}/g, function(value, key) {
      // Replace with paramter, otherwise keep existing value
      return parameters[key];
    });

    overpass.run_query(query, "OverpassQL");
  });
  ide.map.on('locationfound', onLocationFound);
  ide.map.on('locationerror', onLocationError);

  // overpass functionality
  overpass.handlers["onAjaxError"] = function(errmsg) {alert("An error occured during the execution of the overpass query!\n" + errmsg);};
  overpass.handlers["onQueryError"] = function(errmsg) {alert("An error occured during the execution of the overpass query!\nThis is what overpass API returned:\n" + errmsg);};
  overpass.handlers["onGeoJsonReady"] = function() {ide.map.addLayer(overpass.osmLayer);};
  overpass.handlers["onDataRecieved"] = function(amount,txt, abortCB,continueCB) {
    continueCB();

    // Remove splash
    setTimeout(function() {
      splash.classList.add("hidden");
    }, 2000);
  };
  overpass.handlers["onClickFeature"] = function(feature) {
    if (disableFeatureInteraction) {
      return;
    }

    if (!settings.osmUser || !settings.osmPass) {
      // Show failed alert
      failureNotification.innerHTML = "No OSM username or password";
      failureNotification.classList.remove("hidden");

      setTimeout(function() {
        failureNotification.classList.add("hidden");
      }, 5000);

      return;
    }

    disableFeatureInteraction = true;
    disableMapControls();

    // Trigger tagging process
    measureHeight().then(function(height) {
      // Save to OSM
      return saveToOSM(feature, height);
    }).done(function() {
      // Show success alert
      successNotification.classList.remove("hidden");

      setTimeout(function() {
        successNotification.classList.add("hidden");
      }, 5000);

      // Enable map
      disableFeatureInteraction = false;
      enableMapControls();
    }, function(error) {
      console.log(error);

      // Show failed alert
      failureNotification.innerHTML = "Failed to save, try again.";
      failureNotification.classList.remove("hidden");

      setTimeout(function() {
        failureNotification.classList.add("hidden");
      }, 5000);

      // Enable map
      disableFeatureInteraction = false;
      enableMapControls();
    });
  };
};

var disableMapControls = function() {
  ide.map.dragging.disable();
  ide.map.touchZoom.disable();
  ide.map.doubleClickZoom.disable();
  ide.map.scrollWheelZoom.disable();
  ide.map.boxZoom.disable();
  ide.map.keyboard.disable();
};

var enableMapControls = function() {
  ide.map.dragging.enable();
  ide.map.touchZoom.enable();
  ide.map.doubleClickZoom.enable();
  ide.map.scrollWheelZoom.enable();
  ide.map.boxZoom.enable();
  ide.map.keyboard.enable();
};

var onLocationFound = function(e) {
  var radius = e.accuracy / 2;
  L.marker(e.latlng).addTo(ide.map).bindPopup("You are within " + radius + " meters from this point");
};

var onLocationError = function(e) {
  console.log(e.message);
};

// Measuring bits and pieces

navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

var distanceValue = document.getElementById("distance").querySelector(".value");
var heightValue = document.getElementById("height").querySelector(".value");

var setBottomButton = document.getElementById("set-bottom");
var setTopButton = document.getElementById("set-top");
var confirmButton = document.getElementById("confirm");

// Set up camera DOM
var video = document.getElementById("cameraView");
video.height = window.innerHeight;

var cameraSources;

var measureHeight = function() {
  var deferred = Q.defer();

  setBottomButton.disabled = true;
  setTopButton.disabled = true;

  confirmButton.classList.add("hidden");

  // Orientation values store
  var deviceOrientation = {
    tiltLR: 0,
    tiltFB: 0,
    heading: 0
  };

  // Measured values store
  var measuredValues = {
    distance: 0,
    height: 0,
    bottomAngle: 0,
    topAngle: 0
  };

  distanceValue.innerHTML = "0";
  heightValue.innerHTML = "0";

  var _onDeviceOrienation = function(event) {
    // gamma is the left-to-right tilt in degrees, where right is positive
    var tiltLR = event.gamma;

    // beta is the front-to-back tilt in degrees, where front is positive
    var tiltFB = event.beta;

    // alpha is the compass direction the device is facing in degrees
    var heading = event.alpha

    deviceOrientation.tiltLR = tiltLR;
    deviceOrientation.tiltFB = tiltFB;
    deviceOrientation.heading = heading;
  };

  var closeMeasurementButton = document.getElementById("close-measurement");
  closeMeasurementButton.addEventListener("click", function _onCloseMeasurement(event) {
    // Disable camera
    stopCamera();

    // Stop tracking orientation
    window.removeEventListener("deviceorientation", _onDeviceOrienation, false);

    document.getElementById("measurement").classList.remove("active");

    closeMeasurementButton.removeEventListener("click", _onCloseMeasurement);

    deferred.reject("Closed by user");
  });

  // Show measurement window
  document.getElementById("measurement").classList.add("active");

  // Start tracking orienation
  // Find camera sources
  getCameraSources().then(function() {
    // Start orientation
    if (window.DeviceOrientationEvent) {
      window.addEventListener("deviceorientation", _onDeviceOrienation, false);
    } else {
      console.log("Orientation not supported");
      deferred.reject("Orientation not supported");
    }

    return startCamera();
  }).then(function() {
    var _deferred = Q.defer();

    setBottomButton.disabled = false;

    // Calculate height
    setBottomButton.addEventListener("click", function _setBottomValue() {
      setBottomValue(measuredValues, deviceOrientation);
      setTopButton.disabled = false;
      setTopButton.addEventListener("click", function _setTopValue() {
        setTopValue(measuredValues, deviceOrientation);

        confirmButton.classList.remove("hidden");

        // Confirm height
        confirmButton.addEventListener("click", function _confirm() {
          setBottomButton.removeEventListener("click", _setBottomValue);
          setTopButton.removeEventListener("click", _setTopValue);
          confirmButton.removeEventListener("click", _confirm);

          _deferred.resolve();
        });
      });
    });

    return _deferred.promise;
  }).then(function() {
    // Disable camera
    stopCamera();

    // Stop tracking orientation
    window.removeEventListener("deviceorientation", _onDeviceOrienation, false);

    document.getElementById("measurement").classList.remove("active");

    deferred.resolve(measuredValues.height);
  });

  return deferred.promise;
};

var getCameraSources = function() {
  var deferred = Q.defer();

  if (!cameraSources) {
    if (typeof MediaStreamTrack === 'undefined'){
      console.log("This browser does not support MediaStreamTrack");
    } else {
      MediaStreamTrack.getSources(function(sourcesInfo) {
        cameraSources = sourcesInfo;
        deferred.resolve();
      });
    }
  } else {
    deferred.resolve();
  }

  return deferred.promise;
};

var startCamera = function() {
  var deferred = Q.defer();

  var constraints = {audio: false, video: {
    mandatory: {
      // minWidth: 1280,
      minHeight: 720
    },
    optional: [{sourceId: (cameraSources[1]) ? cameraSources[1].id : cameraSources[0].id}]
  }};

  navigator.getUserMedia(constraints, function(stream) {
    window.stream = stream; // stream available to console
    if (window.URL) {
      video.src = window.URL.createObjectURL(stream);
    } else {
      video.src = stream;
    }

    deferred.resolve();
  }, function(error) {
    console.log("navigator.getUserMedia error: ", error);
  });
  video.play();

  return deferred.promise;
};

var stopCamera = function() {
  video.pause();
  window.stream.stop();
};

var setBottomValue = function(measuredValues, deviceOrientation) {
  measuredValues.bottomAngle = deviceOrientation.tiltFB;

  // Perform distance calculation
  // http://stackoverflow.com/questions/4588485/is-it-possible-to-measure-distance-to-object-with-camera/4589633#4589633
  var distance = Math.tan(degToRad(measuredValues.bottomAngle)) * (settings.heightToFloor + settings.heightToEyes);

  measuredValues.distance = distance;
  distanceValue.innerHTML = distance.toFixed(2);
};

var setTopValue = function(measuredValues, deviceOrientation) {
  measuredValues.topAngle = deviceOrientation.tiltFB;

  // Perform height calculation
  // Normalise angle to make 0 degrees equal to device facing away from eye-level
  // http://help.sketchup.com/en/article/167464
  var height = Math.tan(degToRad(measuredValues.topAngle - 90)) * measuredValues.distance;

  height += settings.heightToFloor + settings.heightToEyes;
  
  measuredValues.height = height;
  heightValue.innerHTML = height.toFixed(2);
};

var degToRad = function(deg) {
  return deg * (Math.PI / 180);
}


// Save to OSM bits and pieces

var saveToOSM = function(feature, height) {
  var deferred = Q.defer();

  height = height.toFixed(2);

  var featureJXON;

  osmGetElement(feature.properties.id).then(function(osmFeature) {
    featureJXON = JXON.build(osmFeature.querySelector("osm"));

    var alreadySet = false;

    var tagCount = featureJXON.way.tag.length;
    for (var i = 0; i < tagCount; i++) {
      var tag = featureJXON.way.tag[i];
      if (tag["@k"] == "height") {
        console.log("Height tag already set, overwriting");
        tag["@v"] = height;
        alreadySet = true;
        break;
      }
    }

    if (!alreadySet) {
      featureJXON.way.tag.push({
        "@k": "height",
        "@v": height
      });
    }

    return osmCreateChangeset(featureJXON);
  }).then(function(changesetId) {
    // Update changeset details
    featureJXON.way["@changeset"] = changesetId;

    var changeset = {
      osmChange: {
        "@version": "0.6",
        "@generator": "ViziCities Building Tagger",
        "modify": {
          "way": featureJXON.way
        }
      }
    };

    // console.log(changeset);

    return osmUploadChangeset(changesetId, changeset);
  }).then(function(changesetId) {
    return osmCloseChangeset(changesetId);
  }).done(function() {
    console.log("Saved height for building " + feature.id + " to OSM");
    deferred.resolve();
  }, function(error) {
    deferred.reject(error);
  });

  return deferred.promise;
};

var osmGetElement = function(id) {
  var deferred = Q.defer();

  $.ajax({
    type: "GET",
    url: settings.osmURL + "/api/0.6/way/" + id,
    headers: {
      "Authorization": "Basic " + btoa(settings.osmUser + ":" + settings.osmPass),
    },
    timeout: 3000,
    success: function(response){
      deferred.resolve(response);
    },
    error: function(xhr, type){
      deferred.reject("AJAX error: ", type);
    }
  });

  return deferred.promise;
};

var osmCreateChangeset = function() {
  var deferred = Q.defer();

  var changeset = {
    osm: {
      changeset: {
        tag: [{
          "@k": "created_by",
          "@v": "ViziCities Building Tagger"
        }, {
          "@k": "comment",
          "@v": "Adding building height"
        }],
        "@version": "0.6",
        "@generator": "ViziCities Building Tagger",
      }
    }
  };

  // console.log(JXON.stringify(changeset));

  $.ajax({
    type: "PUT",
    url: settings.osmURL + "/api/0.6/changeset/create",
    data: JXON.stringify(changeset),
    headers: {
      "Authorization": "Basic " + btoa(settings.osmUser + ":" + settings.osmPass),
      "Content-Type": "text/xml"
    },
    timeout: 3000,
    success: function(response){
      deferred.resolve(response);
    },
    error: function(xhr, type){
      deferred.reject("AJAX error: ", type);
    }
  });

  return deferred.promise;
};

var osmUploadChangeset = function(changesetId, changeset) {
  var deferred = Q.defer();

  $.ajax({
    type: "POST",
    url: settings.osmURL + "/api/0.6/changeset/" + changesetId + "/upload",
    data: JXON.stringify(changeset),
    headers: {
      "Authorization": "Basic " + btoa(settings.osmUser + ":" + settings.osmPass),
      "Content-Type": "text/xml"
    },
    timeout: 3000,
    success: function(response) {
      deferred.resolve(changesetId, response);
    },
    error: function(xhr, type){
      deferred.reject("AJAX error: ", type);
    }
  });

  return deferred.promise;
};

var osmCloseChangeset = function(changesetId) {
  var deferred = Q.defer();

  $.ajax({
    type: "PUT",
    url: settings.osmURL + "/api/0.6/changeset/" + changesetId + "/close",
    headers: {
      "Authorization": "Basic " + btoa(settings.osmUser + ":" + settings.osmPass)
    },
    timeout: 3000,
    success: function(response){
      deferred.resolve(response);
    },
    error: function(xhr, type){
      deferred.reject("AJAX error: ", type);
    }
  });

  return deferred.promise;
};

// Grab settings and init map
localforage.getItem("settings").then(function(localSettings) {
  if (localSettings) {
    console.log("Local settings found");
    settings = localSettings;
  } else {
    console.log("No local settings found");
  }

  initMap();
});