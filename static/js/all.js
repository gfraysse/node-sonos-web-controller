"use strict";

var Sonos = {
	currentState: {
		selectedZone: null,
		zoneInfo: null
	},
	grouping: {},
	players: {},
	groupVolume: {
		disableUpdate: false,
		disableTimer: null
	},
	currentZoneCoordinator: function () {
		return Sonos.players[Sonos.currentState.selectedZone];
	}
};

var currentLibrary = 'rootLibrary';
var currentArtist = '';
var currentAlbumTitle = '';
var currentRelativeDirectory ='';

var rootLibraryMenuItems = [ 'Sonos Favorites', 'Music Library', 'Live MP3', 'Radio' ];
var rootLibraryMenuIcons = [ 'images/browse_playlist.png', 'images/browse_generic_track.png', 'images/browse_generic_track.png', 'images/browse_generic_missing.png' ];
var musicLibraryMenuItems = [ 'Artists', 'Albums', 'Composers', 'Genre', 'Tracks', 'Imported Playlists', 'Folders' ];
var tracksMenuItems = [ 'Play Now', 'Play Next', 'Add to Queue', 'Replace Queue', 'Add to...', 'Info & Options' ];

///
/// GUI Init
///

var GUI = {
	masterVolume: new VolumeSlider(document.getElementById('master-volume'), function (volume) {
			socket.emit('group-volume', {uuid: Sonos.currentState.selectedZone, volume: volume});
		}, function (obj) {
			// this logic controls show/hide of the individual volume controls
			var playerVolumesNode = document.getElementById('player-volumes');
			if (playerVolumesNode.classList.contains('hidden')) {
				playerVolumesNode.classList.remove('hidden');
				playerVolumesNode.classList.add('visible');
				document.addEventListener('click', function hideVolume(e) {
					// ignore the master volume
					if (e.target == obj) return;
					var playerVolumeContainer = document.getElementById('player-volumes');
					function isChildOf(child) {
						// ignore master volume elements
						if (child == obj) return true;
						// ignore player volume container
						if (child == playerVolumeContainer) return true;
						if (child == document) return false;
						return isChildOf(child.parentNode);
					}
					// and the playerVolume
					if (isChildOf(e.target)) return;

					// This is a random click, hide it and remove the container
					playerVolumesNode.classList.add('hidden');
					playerVolumesNode.classList.remove('visible');
					document.removeEventListener('click', hideVolume);

				});
				return false;
			}
			return true;
		}),
	playerVolumes: {},
	progress: new ProgressBar(document.getElementById('position-bar'), function (position) {
		// calculate new time
		var player = Sonos.currentZoneCoordinator();
		console.log(player.state)
		var desiredElapsed = Math.round(player.state.currentTrack.duration * position);
		player.state.elapsedTime = desiredElapsed;
		socket.emit('track-seek', {uuid: player.uuid, elapsed: desiredElapsed});
	})
};

///
/// socket events
///
socket.on('topology-change', function (data) {
	Sonos.grouping = {};
	var stateTime = new Date().valueOf();
	var shouldRenderVolumes = false;
	data.forEach(function (player) {
		player.stateTime = stateTime;
		Sonos.players[player.uuid] = player;
		if (!Sonos.grouping[player.coordinator]) Sonos.grouping[player.coordinator] = [];
		Sonos.grouping[player.coordinator].push(player.uuid);
	});

	console.log("topology-change", Sonos.grouping, Sonos.players);

	// If the selected group dissappeared, select a new one.
	if (!Sonos.grouping[Sonos.currentState.selectedZone]) {
		// just get first zone available
		for (var uuid in Sonos.grouping) {
			Sonos.currentState.selectedZone = uuid;
			break;
		}
		// we need queue as well!
		socket.emit('queue', {uuid:Sonos.currentState.selectedZone});
		shouldRenderVolumes = true;
	}

	if (shouldRenderVolumes) renderVolumes();

	reRenderZones();
	updateControllerState();
	updateCurrentStatus();
});

socket.on('transport-state', function (player) {
	player.stateTime = new Date().valueOf();
	Sonos.players[player.uuid] = player;
	reRenderZones();
	var selectedZone = Sonos.currentZoneCoordinator();
	console.log(selectedZone)
	updateControllerState();
	updateCurrentStatus();

});

socket.on('group-volume', function (data) {

	Sonos.players[data.uuid].groupState.volume = data.groupState.volume;
	if (data.uuid == Sonos.currentState.selectedZone) {
		GUI.masterVolume.setVolume(data.groupState.volume);
	}
	for (var uuid in data.playerVolumes) {
		Sonos.players[data.uuid].state.volume = data.playerVolumes[uuid];
		GUI.playerVolumes[uuid].setVolume(data.playerVolumes[uuid]);
	}
});

socket.on('group-mute', function (data) {
	Sonos.players[data.uuid].groupState = data.state;
	updateControllerState();
});

socket.on('mute', function (data) {
	var player = Sonos.players[data.uuid];
	player.state.mute = data.state.mute;
	document.getElementById("mute-" + player.uuid).src = data.state.mute ? 'svg/mute_on.svg' : 'svg/mute_off.svg';
});

socket.on('favorites', function (data) {
	renderFavorites(data);
});

socket.on('root-menu', function (data) {
	renderRootLibraryMenu(data);
});

socket.on('artists', function (data) {
	renderArtists(data);
});

socket.on('browse-live-mp3', function (data) {
	renderLiveMP3Root(data);
});

socket.on('live-mp3-directory', function (dir, mp3Files, otherFiles) {
	renderLiveMP3Directory(dir, mp3Files, otherFiles);
});

socket.on('radios', function (data) {
	renderRadios(data);
});

socket.on('albums', function (data) {
	renderAlbums(data);
});

socket.on('albumTracks', function (data) {
	renderAlbumTracks(data);
});

socket.on('queue', function (data) {
	console.log("received queue", data.uuid);
	if (data.uuid != Sonos.currentState.selectedZone) return;
	renderQueue(data.queue);
});

///
/// GUI events
///

document.getElementById('zone-container').addEventListener('click', function (e) {
	// Find the actual UL
	function findZoneNode(currentNode) {
		// If we are at top level, abort.
		if (currentNode == this) return;
		if (currentNode.tagName == "UL") return currentNode;
		return findZoneNode(currentNode.parentNode);
	}

	var zone = findZoneNode(e.target);

	if (!zone) return;

	var previousZone = document.getElementById(Sonos.currentState.selectedZone);
	if (previousZone) previousZone.classList.remove('selected');

	Sonos.currentState.selectedZone = zone.id;
	zone.classList.add('selected');
	// Update controls with status
	updateControllerState();
	updateCurrentStatus();

	// fetch queue
	socket.emit('queue', {uuid: Sonos.currentState.selectedZone});

}, true);

document.getElementById('master-mute').addEventListener('click', function () {

	var action;
	// Find state of current player
	var player = Sonos.currentZoneCoordinator();

	// current state
	var mute = player.groupState.mute;
	socket.emit('group-mute', {uuid: player.uuid, mute: !mute});

	// update
	if (mute)
		this.src = this.src.replace(/_on\.svg/, '_off.svg');
	else
		this.src = this.src.replace(/_off\.svg/, '_on.svg');

});

document.getElementById('play-pause').addEventListener('click', function () {

	var action;
	// Find state of current player
	var player = Sonos.currentZoneCoordinator();
	if (player.state.zoneState == "PLAYING" ) {
		action = 'pause';
	} else {
		action = 'play';
	}

	console.log(action, Sonos.currentState)
	socket.emit('transport-state', { uuid: Sonos.currentState.selectedZone, state: action });
});

document.getElementById('next').addEventListener('click', function () {
	var action = "nextTrack";
	console.log(action, Sonos.currentState)
	socket.emit('transport-state', { uuid: Sonos.currentState.selectedZone, state: action });
});
document.getElementById('prev').addEventListener('click', function () {
	var action = "previousTrack";
	console.log(action, Sonos.currentState)
	socket.emit('transport-state', { uuid: Sonos.currentState.selectedZone, state: action });
});

document.getElementById('library-browser-back-button').addEventListener('click', function (e) {
    function findNode(currentNode) {
	// If we are at top level, abort.
	if (currentNode == this) return;
	if (currentNode.tagName == "LI") return currentNode;
	return findNode(currentNode.parentNode);
    }
    var li = findNode(document.getElementById('library-container'));
    console.log("li=", li);
    // Order of pages to display is rootLibrary -> artistLibrary -> artistAlbumsLibrary -> albumLibrary or rootLibrary -> favoritesLibrary
    //console.log("library-browser-back-button clicked, currentLibrary=", currentLibrary);
    if (currentLibrary == 'rootLibrary') {
	socket.emit('library-root-menu');
	currentLibrary = 'rootLibrary';
	//console.log("library-browser-back-button END, currentLibrary=", currentLibrary);
	return;
    }
    if (currentLibrary == 'artistLibrary' || currentLibrary == 'favoritesLibrary') {
	socket.emit('library-root-menu');
	currentLibrary = 'rootLibrary';
	//console.log("library-browser-back-button END, currentLibrary=", currentLibrary);
	return;
    }
    if (currentLibrary == 'albumLibrary') {
	socket.emit('browse-artist', {uuid: Sonos.currentState.selectedZone, artist: currentArtist});
	currentLibrary = 'artistAlbumsLibrary';
	//console.log("library-browser-back-button END, currentLibrary=", currentLibrary);
	return;
    }
    if (currentLibrary == 'artistAlbumsLibrary') {
	currentLibrary= 'artistLibrary';
	socket.emit('list-artists', {uuid: Sonos.currentState.selectedZone});
	//console.log("library-browser-back-button END, currentLibrary=", currentLibrary);
	return;
    }
// if (currentLibrary == 'artistLiveMP3File') {
 if (currentLibrary == 'liveMP3Library') {
     if (currentRelativeDirectory.trim() == '') {
	 socket.emit('library-root-menu');
	 currentLibrary = 'rootLibrary';
     }
     else {
	 var n = currentRelativeDirectory.lastIndexOf('/');
	currentRelativeDirectory = currentRelativeDirectory.substr (0, n);
	socket.emit('browse-live-mp3-file', {uuid: Sonos.currentState.selectedZone, artist: currentRelativeDirectory});
	return;
     }
	return;
    }

    //console.log("library-browser-back-button END ????, currentLibrary=", currentLibrary);
});

/*
document.getElementById('music-sources-container').addEventListener('click', function (e) {
    function findNode(currentNode) {
		// If we are at top level, abort.
		if (currentNode == this) return;
		if (currentNode.tagName == "LI") return currentNode;
		return findNode(currentNode.parentNode);
    }
    var li = findNode(e.target);

	if (currentLibrary == 'albumLibrary') {
		console.log("displaying contextual menu");
		socket.emit('display-track-menu', {uuid: Sonos.currentState.selectedZone, title: li.dataset.title, uri: li.dataset.uri });
		currentLibrary= 'albumLibrary';
		return;
    }

});
*/
document.getElementById('music-sources-container').addEventListener('dblclick', function (e) {
    function findNode(currentNode) {
	// If we are at top level, abort.
	if (currentNode == this) return;
	if (currentNode.tagName == "LI") return currentNode;
	return findNode(currentNode.parentNode);
    }
    var li = findNode(e.target);

    if (currentLibrary == 'rootLibrary') {
	console.log("rootLibrary", li.textContent);
	currentRelativeDirectory ='';
	switch (li.textContent) {
	    case rootLibraryMenuItems [0]:
	    currentLibrary= 'favoritesLibrary';	    
	    socket.emit('list-favorites', {uuid: Sonos.currentState.selectedZone});
	    break;
	    case rootLibraryMenuItems [1]:
	    currentLibrary= 'artistLibrary';
	    socket.emit('list-artists', {uuid: Sonos.currentState.selectedZone});
	    break;
	    case rootLibraryMenuItems [2]:
	    currentLibrary= 'liveMP3Library';
	    socket.emit('list-live-mp3', {uuid: Sonos.currentState.selectedZone});
	    break;
	    case rootLibraryMenuItems [3]:
	    currentLibrary= 'RadioLibrary';
	    socket.emit('list-radios', {uuid: Sonos.currentState.selectedZone});
	    break;
	    default:
	}
	return;
    }
    if (currentLibrary == 'favoritesLibrary') {
	socket.emit('play-favorite', {uuid: Sonos.currentState.selectedZone, favorite: li.dataset.title});
	currentLibrary= 'favoritesLibrary';
	return;
    }
    if (currentLibrary == 'albumLibrary') {
	//console.log("alltitle", li.dataset.alltitle );
	//socket.emit('play-track', {uuid: Sonos.currentState.selectedZone, title: li.dataset.title, alltitle: li.dataset.alltitle, uri: li.dataset.uri });
	socket.emit('play-track', {uuid: Sonos.currentState.selectedZone, title: li.dataset.title, uri: li.dataset.uri });
	currentLibrary= 'albumLibrary';
	return;
    }
    if (currentLibrary == 'artistAlbumsLibrary') {
	socket.emit('browse-album', {uuid: Sonos.currentState.selectedZone, album: li.dataset.title});
	currentAlbumTitle = li.dataset.title;
	currentLibrary= 'albumLibrary';
	return;
    }
    if (currentLibrary == 'artistLibrary') {
	socket.emit('browse-artist', {uuid: Sonos.currentState.selectedZone, artist: li.dataset.title});
	currentArtist = li.dataset.title;
	currentLibrary= 'artistAlbumsLibrary';
	return;
    }
    if (currentLibrary == 'liveMP3Library') {
	//console.log("liveMP3Library", li.textContent, li.dataset.title );
	currentRelativeDirectory = currentRelativeDirectory + '/' + li.dataset.title;
	socket.emit('browse-live-mp3-file', {uuid: Sonos.currentState.selectedZone, artist: currentRelativeDirectory});
	currentLibrary= 'liveMP3Library';
	return;
    }
});

document.getElementById('status-container').addEventListener('dblclick', function (e) {
	function findQueueNode(currentNode) {
		// If we are at top level, abort.
		if (currentNode == this) return;
		if (currentNode.tagName == "LI") return currentNode;
		return findQueueNode(currentNode.parentNode);
	}
	var li = findQueueNode(e.target);
	if (!li) return;
	socket.emit('seek', {uuid: Sonos.currentState.selectedZone, trackNo: li.dataset.trackNo});
});

document.getElementById('position-info').addEventListener('click', function (e) {
	function findActionNode(currentNode) {
		if (currentNode == this) return;
		if (currentNode.className == "playback-mode") return currentNode;
		return findActionNode(currentNode.parentNode);
	}

	var actionNode = findActionNode(e.target);
	if (!actionNode) return;

	var action = actionNode.id;
	var data = {};
	var state = /off/.test(actionNode.src) ? true : false;
	data[action] = state;

	var selectedZone = Sonos.currentZoneCoordinator();
	// set this directly for instant feedback
	selectedZone.playMode[action] = state;
	updateCurrentStatus();
	socket.emit('playmode', {uuid: Sonos.currentState.selectedZone, state: data});

});

document.getElementById('player-volumes-container').addEventListener('click', function (e) {
	var muteButton = e.target;
	if (!muteButton.classList.contains('mute-button')) return;



	// this is a mute button, go.
	var player = Sonos.players[muteButton.dataset.id];
	var state = !player.state.mute;
	socket.emit('mute', {uuid: player.uuid, mute: state});

	// update GUI
		// update
	if (state)
		muteButton.src = muteButton.src.replace(/_off\.svg/, '_on.svg');
	else
		muteButton.src = muteButton.src.replace(/_on\.svg/, '_off.svg');

});

document.getElementById("current-track-art").addEventListener('load', function (e) {
	// new image loaded. update favicon
	// This prevents duplicate requests!
	//console.log('albumart loaded', this.src)
	var oldFavicon = document.getElementById("favicon");
	var newFavicon = oldFavicon.cloneNode();
	newFavicon.href = this.src;
	newFavicon.type = "image/png";
	oldFavicon.parentNode.replaceChild(newFavicon, oldFavicon);

});

///
/// ACTIONS
///

function updateCurrentStatus() {
	var selectedZone = Sonos.currentZoneCoordinator();
	document.getElementById("current-track-art").src =  selectedZone.state.currentTrack.albumArtURI;
	document.getElementById('page-title').textContent = selectedZone.state.currentTrack.title + ' - Sonos Web Controller';
	document.getElementById("track").textContent = selectedZone.state.currentTrack.title;
	document.getElementById("artist").textContent = selectedZone.state.currentTrack.artist;
	document.getElementById("album").textContent = selectedZone.state.currentTrack.album;

	if (selectedZone.state.nextTrack) {
		var nextTrack = selectedZone.state.nextTrack;
		document.getElementById("next-track").textContent = nextTrack.title + " - " + nextTrack.artist;
	}

	console.log(selectedZone)

	var repeat = document.getElementById("repeat");
	if (selectedZone.playMode.repeat) {
		repeat.src = repeat.src.replace(/_off\.png/, "_on.png");
	} else {
		repeat.src = repeat.src.replace(/_on\.png/, "_off.png");
	}

	var shuffle = document.getElementById("shuffle");
	if (selectedZone.playMode.shuffle) {
		shuffle.src = shuffle.src.replace(/_off\.png/, "_on.png");
	} else {
		shuffle.src = shuffle.src.replace(/_on\.png/, "_off.png");
	}

	var crossfade = document.getElementById("crossfade");
	if (selectedZone.playMode.crossfade) {
		crossfade.src = crossfade.src.replace(/_off\.png/, "_on.png");
	} else {
		crossfade.src = crossfade.src.replace(/_on\.png/, "_off.png");
	}


	GUI.progress.update(selectedZone);
}

function updateControllerState() {
	var currentZone = Sonos.currentZoneCoordinator();
	var state = currentZone.state.zoneState;
	var playPauseButton = document.getElementById('play-pause');

	if (state == "PLAYING") {
		playPauseButton.src = '/svg/pause.svg';
	} else {
		playPauseButton.src = '/svg/play.svg';
	}

	// Fix volume
	GUI.masterVolume.setVolume(currentZone.groupState.volume);

	// fix mute
	var masterMute = document.getElementById('master-mute');
	if (currentZone.groupState.mute) {
		masterMute.src = "/svg/mute_on.svg";
	} else {
		masterMute.src = "/svg/mute_off.svg";
	}

	// fix volume container

	var allVolumes = {};
	for (var uuid in Sonos.players) {
		// is this in group?
		allVolumes[uuid] = null;
	}

	Sonos.grouping[Sonos.currentState.selectedZone].forEach(function (uuid) {
		document.getElementById("volume-" + uuid).classList.remove("hidden");
		delete allVolumes[uuid];
	});

	// now, hide the ones left
	for (var uuid in allVolumes) {
		document.getElementById("volume-" + uuid).classList.add("hidden");
	}

}

function toFormattedTime(seconds) {
		var chunks = [];
		var modulus = [60^2, 60];
		var remainingTime = seconds;
		// hours
		var hours = Math.floor(remainingTime/3600);

		if (hours > 0) {
			chunks.push(zpad(hours, 1));
			remainingTime -= hours * 3600;
		}

		// minutes
		var minutes = Math.floor(remainingTime/60);
		chunks.push(zpad(minutes, 1));
		remainingTime -= minutes * 60;
		// seconds
		chunks.push(zpad(Math.floor(remainingTime), 2))
		return chunks.join(':');
}

function zpad(number, width) {
	var str = number + "";
	if (str.length >= width) return str;
	var padding = new Array(width - str.length + 1).join('0');
	return padding + str;
}

function VolumeSlider(containerObj, callback, clickCallback) {
	var state = {
		cursorX: 0,
		originalX: 0,
		maxX: 0,
		currentX: 0,
		slider: null,
		volume: 0,
		disableUpdate: false,
		disableTimer: null
	};

	function setVolume(volume) {
		// calculate a pixel offset based on percentage
		if (state.volume == volume) return;
		setScrubberPosition(volume);
		if (typeof callback == "function")
			callback(volume);
	}

	function setScrubberPosition(volume) {
		var offset = Math.round(state.maxX * volume / 100);
		state.currentX = offset;
		state.slider.style.marginLeft = offset + 'px';
		state.volume = volume;
	}

	function handleVolumeWheel(e) {
		var newVolume;
		if(e.deltaY > 0) {
			// volume down
			newVolume = state.volume - 2;
		} else {
			// volume up
			newVolume = state.volume + 2;
		}
		if (newVolume < 0) newVolume = 0;
		if (newVolume > 100) newVolume = 100;

		setVolume( newVolume );
		clearTimeout(state.disableTimer);
		state.disableUpdate = true;
		state.disableTimer = setTimeout(function () {state.disableUpdate = false}, 800);

		//socket.emit('group-volume', {uuid: Sonos.currentState.selectedZone, volume: newVolume});
		//newVolume = Sonos.currentZoneCoordinator().groupState.volume = newVolume;


	}

	function handleClick(e) {
		// Be able to cancel this from a callback if necessary
		if (typeof clickCallback == "function" && clickCallback(this) == false) return;

		if (e.target.tagName == "IMG") return;

		var newVolume;
		if(e.layerX < state.currentX) {
			// volume down
			newVolume = state.volume - 2;
		} else {
			// volume up
			newVolume = state.volume + 2;
		}

		if (newVolume < 0) newVolume = 0;
		if (newVolume > 100) newVolume = 100;

		setVolume(newVolume);
		clearTimeout(state.disableTimer);
		state.disableUpdate = true;
		state.disableTimer = setTimeout(function () {state.disableUpdate = false}, 800);
	}

	function onDrag(e) {
		var deltaX = e.clientX - state.cursorX;
		var nextX = state.originalX + deltaX;

		if ( nextX > state.maxX ) nextX = state.maxX;
		else if ( nextX < 1) nextX = 1;

		// calculate percentage
		var volume = Math.floor(nextX / state.maxX * 100);
		setVolume(volume);
	}

	var sliderWidth = containerObj.clientWidth;
	state.maxX = sliderWidth - 21;
	state.slider = containerObj.querySelector('img');

	state.slider.addEventListener('mousedown', function (e) {
		state.cursorX = e.clientX;
		state.originalX = state.currentX;
		clearTimeout(state.disableTimer);
		state.disableUpdate = true;
		document.addEventListener('mousemove', onDrag);
		e.preventDefault();
	});

	document.addEventListener('mouseup', function () {
		document.removeEventListener('mousemove', onDrag);
		state.currentX = state.slider.offsetLeft;
		state.disableTimer = setTimeout(function () { state.disableUpdate = false }, 800);
	});

	// Since Chrome 31 wheel event is also supported
	containerObj.addEventListener("wheel", handleVolumeWheel);

	// For click-to-adjust
	containerObj.addEventListener("click", handleClick);



	// Add some functions to go
	this.setVolume = function (volume) {
		if (state.disableUpdate) return;
		setScrubberPosition(volume);
	}

	return this;
}

function ProgressBar(containerObj, callback) {
	var state = {
		cursorX: 0,
		originalX: 0,
		maxX: 0,
		currentX: 0,
		slider: null,
		progress: 0,
		slideInProgress: false,
		elapsed: 0,
		duration: 0,
		lastUpdate: 0,
		zoneState: "STOPPED",
		hasBeenDragged: false
	};

	var progressAdjustTimer, tickerInterval;

	// Update position
	this.setPosition = function (position) {
		if (state.slideInProgress) return;
		setPosition(position);
	}

	this.update = function (selectedZone) {

		state.elapsed = selectedZone.state.elapsedTime;
		state.duration = selectedZone.state.currentTrack.duration;
		state.lastUpdate = selectedZone.stateTime;
		state.zoneState = selectedZone.state.zoneState;

		clearInterval(tickerInterval);

		console.log(state)

		if (state.zoneState == "PLAYING")
			tickerInterval = setInterval(updatePosition, 500);

		updatePosition();
	}

	function updatePosition(force) {
		if (state.slideInProgress && !force) return;
		var elapsedMillis, realElapsed;

		if (state.zoneState == "PLAYING") {
			elapsedMillis = state.elapsed*1000 + (Date.now() - state.lastUpdate);
			realElapsed = Math.floor(elapsedMillis/1000);
		} else {
			realElapsed = state.elapsed;
			elapsedMillis = realElapsed * 1000;
		}

		document.getElementById("countup").textContent = toFormattedTime(realElapsed);
		var remaining = state.duration - realElapsed;
		document.getElementById("countdown").textContent = "-" + toFormattedTime(remaining);
		var position = elapsedMillis / (state.duration*1000);
		setPosition(position);
	}

	function setPosition(position) {
		// calculate offset
		var offset = Math.round(state.maxX * position);
		state.slider.style.marginLeft = offset + "px";
		state.currentX = offset;
		state.progress = position;
	}

	function handleMouseWheel(e) {
		console.log(state)
		var newProgress;
		state.elapsed = state.elapsed + (Date.now() - state.lastUpdate)/1000;
		state.lastUpdate = Date.now();

		if(e.deltaY < 0) {
			// wheel down
			state.elapsed += 2;
		} else {
			// wheel up
			state.elapsed -= 2;
		}

		state.slideInProgress = true;
		setPosition( state.elapsed / state.duration );
		updatePosition(true);
		console.log("clearing", progressAdjustTimer)
		clearTimeout(progressAdjustTimer);
		progressAdjustTimer = setTimeout(function () { callback(state.elapsed / state.duration); state.slideInProgress = false}, 800);

	}

	function handleClick(e) {
		if (e.target.tagName == "IMG") return;

		state.elapsed = state.elapsed + (Date.now() - state.lastUpdate)/1000;
		state.lastUpdate = Date.now();

		if(e.layerX > state.currentX) {
			// volume down
			state.elapsed += 2;
		} else {
			// volume up
			state.elapsed -= 2;
		}

		state.slideInProgress = true;
		setPosition( state.elapsed / state.duration );
		updatePosition(true);
		console.log("clearing", progressAdjustTimer)
		clearTimeout(progressAdjustTimer);
		progressAdjustTimer = setTimeout(function () { callback(state.elapsed / state.duration); state.slideInProgress = false}, 2000);
	}

	function onDrag(e) {
		var deltaX = e.clientX - state.cursorX;
		var nextX = state.originalX + deltaX;
		// calculate time
		if (nextX < 1) nextX = 1;
		if (nextX > state.maxX) nextX = state.maxX;
		var progress = nextX / state.maxX;
		setPosition(progress);
		state.hasBeenDragged = true;
	}


	var sliderWidth = containerObj.clientWidth;
	state.maxX = sliderWidth - 5;
	state.slider = containerObj.querySelector('div');
	state.currentX = state.slider.offsetLeft;

	console.log(state)

	state.slider.addEventListener('mousedown', function (e) {
		state.slideInProgress = true;
		state.cursorX = e.clientX;
		state.originalX = state.currentX;
		console.log(e, state)
		state.slider.classList.add('sliding');
		document.addEventListener('mousemove', onDrag);
		e.preventDefault();
	});

	document.addEventListener('mouseup', function () {
		if (!state.slideInProgress || !state.hasBeenDragged ) return;
		document.removeEventListener('mousemove', onDrag);
		if (typeof callback == "function") {
			callback(state.currentX / state.maxX);
		}
		state.slider.classList.remove('sliding');
		state.slideInProgress = false;
		state.hasBeenDragged = false;
	});

	// Since Chrome 31 wheel event is also supported
	console.log(containerObj)
	containerObj.addEventListener("wheel", handleMouseWheel);

	// For click-to-adjust
	containerObj.addEventListener("click", handleClick);
}

var zoneManagement = function() {

	var dragItem;

	function findZoneNode(currentNode) {
		// If we are at top level, abort.
		if (currentNode == this) return;
		if (currentNode.tagName == "UL") return currentNode;
		return findZoneNode(currentNode.parentNode);
	}

	function handleDragStart(e) {
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/html', e.target.innerHTML);
		dragItem = e.target;
		dragItem.classList.add('drag');
	}

	function handleDragEnd(e) {
		dragItem.classList.remove('drag');
	}

	function handleDrop(e) {
		if (e.target == this) {
			// detach
			console.log("detach");
			socket.emit('group-management', {player: dragItem.dataset.id, group: null});
			return;
		}

		var zone = findZoneNode(e.target);
		if (!zone || zone == this.parentNode) return;

		console.log(dragItem.dataset.id, zone.id);
		socket.emit('group-management', {player: dragItem.dataset.id, group: zone.id});

	}

	function handleDragOver(e) {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';

	}

	document.getElementById('zone-container').addEventListener('dragstart', handleDragStart);
	document.getElementById('zone-container').addEventListener('dragend', handleDragEnd);
	document.getElementById('zone-container').addEventListener('dragover', handleDragOver);
	document.getElementById('zone-container').addEventListener('drop', handleDrop);

}();

function renderVolumes() {
	var oldWrapper = document.getElementById('player-volumes');
	var newWrapper = oldWrapper.cloneNode(false);
	var masterVolume = document.getElementById('master-volume');
	var masterMute = document.getElementById('master-mute');

	var playerNodes = [];

	for (var i in Sonos.players) {
		var player = Sonos.players[i];
		var playerVolumeBar = masterVolume.cloneNode(true);
		var playerVolumeBarContainer = document.createElement('div');
		playerVolumeBarContainer.id = "volume-" + player.uuid;
		playerVolumeBar.id = "";
		playerVolumeBar.dataset.uuid = player.uuid;
		var playerName = document.createElement('h6');
		var playerMute = masterMute.cloneNode(true);
		playerMute.id = "mute-" + player.uuid;
		playerMute.className = "mute-button";
		playerMute.src = player.state.mute ? "/svg/mute_on.svg" : "/svg/mute_off.svg";
		playerMute.dataset.id = player.uuid;
		playerName.textContent = player.roomName;
		playerVolumeBarContainer.appendChild(playerName);
		playerVolumeBarContainer.appendChild(playerMute);
		playerVolumeBarContainer.appendChild(playerVolumeBar);
		newWrapper.appendChild(playerVolumeBarContainer);
		playerNodes.push({uuid: player.uuid, node: playerVolumeBar});
	}

	oldWrapper.parentNode.replaceChild(newWrapper, oldWrapper);

	// They need to be part of DOM before initialization
	playerNodes.forEach(function (playerPair) {
		var uuid = playerPair.uuid;
		var node = playerPair.node;
		GUI.playerVolumes[uuid] = new VolumeSlider(node, function (vol) {
			socket.emit('volume', {uuid: uuid, volume: vol});
		});

		console.log(uuid, Sonos.players[uuid].state.volume);

		GUI.playerVolumes[uuid].setVolume(Sonos.players[uuid].state.volume);
	});

	newWrapper.classList.add('hidden');
	newWrapper.classList.remove('loading');
}

function reRenderZones() {
	var oldWrapper = document.getElementById('zone-wrapper');
	var newWrapper = oldWrapper.cloneNode(false);

	for (var groupUUID in Sonos.grouping) {
		var ul = document.createElement('ul');
		ul.id = groupUUID;

		if (ul.id == Sonos.currentState.selectedZone)
			ul.className = "selected";

		Sonos.grouping[groupUUID].forEach(function (playerUUID) {
			var player = Sonos.players[playerUUID];
			var li = document.createElement('li');
			var span = document.createElement('span');
			span.textContent = player.roomName;
			li.appendChild(span);
			li.draggable = true;
			li.dataset.id = playerUUID;
			ul.appendChild(li);
		});

		newWrapper.appendChild(ul);
	}
	oldWrapper.parentNode.replaceChild(newWrapper, oldWrapper);
}

function changeLibraryBrowserTitle (title) {
	var container = document.getElementById('library-browser-title');
	container.textContent = title;
}

function renderFavorites(favorites) {
    cleanLibrayContainer();

	changeLibraryBrowserTitle ("Favorites");

    //var oldContainer = document.getElementById('favorites-container');
    var oldContainer = document.getElementById('library-container');
    var newContainer = oldContainer.cloneNode(false);

    var i = 0;

    favorites.forEach(function (favorite) {
	var li = document.createElement('li');
	li.dataset.title = favorite.title;
	var span = document.createElement('span');
	span.textContent = favorite.title;
	var albumArt = document.createElement('img');
	albumArt.src = favorite.albumArtURI;
	li.appendChild(albumArt);
	li.appendChild(span);
	li.tabIndex = i++;
	newContainer.appendChild(li);
    });


    oldContainer.parentNode.replaceChild(newContainer, oldContainer);
}

function renderArtists(artists) {
    cleanLibrayContainer ();

	changeLibraryBrowserTitle ("Artists");

    var oldContainer = document.getElementById('library-container');
    var newContainer = oldContainer.cloneNode(false);

    var i = 0;
    var initial = "";
    artists.forEach(function (artist) {
	// add a separator for every new startup letter
	if (artist.title[0] != initial) {
	    initial = artist.title[0];
	    var heading = document.createElement('h4');
	    heading.appendChild(document.createTextNode(initial));
	    newContainer.appendChild(heading);
	}

	var li = document.createElement('li');
	li.dataset.title = artist.title;
	var span = document.createElement('span');
	span.textContent = artist.title;
	//		var albumArt = document.createElement('img');
	//		albumArt.src = artist.albumArtURI;
	//		li.appendChild(albumArt);
	li.appendChild(span);
	li.tabIndex = i++;
	newContainer.appendChild(li);
    });


    oldContainer.parentNode.replaceChild(newContainer, oldContainer);
}

function renderLiveMP3Root(files) {
    cleanLibrayContainer ();

    console.log ("renderLiveMP3Root");
    changeLibraryBrowserTitle ("Live MP3");

    var oldContainer = document.getElementById('library-container');
    var newContainer = oldContainer.cloneNode(false);

    var i = 0;
    var initial = "";
    files.forEach(function (file) {
	// add a separator for every new startup letter
	if (file[0] != initial) {
	    initial = file[0];
	    var heading = document.createElement('h4');
	    heading.appendChild(document.createTextNode(initial));
	    newContainer.appendChild(heading);
	}

	var li = document.createElement('li');
	li.dataset.title = file;
	var span = document.createElement('span');
	span.textContent = file;
	//		var albumArt = document.createElement('img');
	//		albumArt.src = artist.albumArtURI;
	//		li.appendChild(albumArt);
	li.appendChild(span);
	li.tabIndex = i++;
	newContainer.appendChild(li);
    });


    oldContainer.parentNode.replaceChild(newContainer, oldContainer);
}

function renderLiveMP3Directory(dir, mp3Files, otherFiles) {
    cleanLibrayContainer ();

    changeLibraryBrowserTitle ("Live MP3");

    var oldContainer = document.getElementById('library-container');
    var newContainer = oldContainer.cloneNode(false);
    var i = 0;

    var table = document.createElement('table');
    table.className ="table table-hover";
    table.id="mt";
    var thead = document.createElement('thead');
    var tbody = document.createElement('tbody');
    var tr1 = document.createElement('tr');

    var li_root = document.createElement('th');
    li_root.id = "albumTrack";
    li_root.dataset.title = 'CompleteAlbum';
    li_root.dataset.uri = '';
    var title_root = document.createElement('p');
    title_root.className = 'title';
    title_root.textContent = "Complete Album (" + (mp3Files.length -1) + " tracks)";

    tr1.appendChild (li_root);
    tbody.appendChild (tr1); 

    mp3Files.forEach(function (track) {
	var li = document.createElement('li');
	li.id = "albumTrack";
	li.dataset.title = track;
	console.log ("dir=",dir);
	var uri = 'http://192.168.1.30/mp3_content/' + dir;
	uri = uri + '/' + track;
	uri = uri.replace(/ /g,"%20");
	console.log ("uri=",uri);

	li.dataset.uri = uri;

	var trackInfo = document.createElement('td');
	trackInfo.id = "albumTrack"; 
	trackInfo.dataset.title = track;
	trackInfo.dataset.uri = uri;
	var title = document.createElement('p');
	title.className = 'title';
	if (i < 9) {
	    title.textContent = '0';
	}
	title.textContent += (i+1)+' '+track;
	trackInfo.appendChild(title);
	var artist = document.createElement('p');
	artist.className = 'artist';
	artist.textContent = track;

	if (i == 0) {
/*
		var albumArt = document.createElement('img');
		albumArt.src = track.albumArtURI;
		li_root.appendChild(albumArt);
*/
//		newContainer.appendChild(li_root);
//		li_root.appendChild(title_root);

		li_root.appendChild(title_root);
	    tr1.appendChild (li_root);
	    tbody.appendChild (tr1); 
	}

	li.tabIndex = i++;

	var tr = document.createElement('tr');
	tr.appendChild (trackInfo);
	tbody.appendChild (tr);

    });


    table.appendChild (tbody);
    newContainer.appendChild(table);

    otherFiles.forEach(function (file) {
	var li = document.createElement('li');
	li.dataset.title = file;
	var span = document.createElement('span');
	span.textContent = file;
	li.appendChild(span);
	li.tabIndex = i++;
	newContainer.appendChild(li);
    });


    oldContainer.parentNode.replaceChild(newContainer, oldContainer);

}

function renderAlbums(albums) {
    cleanLibrayContainer();

	changeLibraryBrowserTitle (currentArtist);

    var oldContainer = document.getElementById('library-container');
    var newContainer = oldContainer.cloneNode(false);

    var i = 0;

    albums.forEach(function (album) {
	var li = document.createElement('li');
	li.dataset.title = album.title;
	var span = document.createElement('span');
	span.textContent = album.title;
	// Don't display album Art for the generic 'All' entry
	if (album.title != "All") {
	    var albumArt = document.createElement('img');
	    albumArt.src = album.albumArtURI;
	    li.appendChild(albumArt);
	}
	li.appendChild(span);
	li.tabIndex = i++;
	newContainer.appendChild(li);
    });


    oldContainer.parentNode.replaceChild(newContainer, oldContainer);
}

function renderRadios(radios) {
    cleanLibrayContainer ();

	changeLibraryBrowserTitle ("Radios");

    var oldContainer = document.getElementById('library-container');
    var newContainer = oldContainer.cloneNode(false);

    radios.forEach(function (radio) {
	var li = document.createElement('li');
	li.dataset.title = radio.title;
	var span = document.createElement('span');
	span.textContent = radio.title;
	var albumArt = document.createElement('img');
	albumArt.src = radio.albumArtURI;
	li.appendChild(albumArt);
	li.appendChild(span);
	newContainer.appendChild(li);
    });


    oldContainer.parentNode.replaceChild(newContainer, oldContainer);
}

function cleanLibrayContainer () {
    var container = document.getElementById('library-container');
    var parChildren = container.children, tmpChildren = [], i, e;
    var tmpArr = [];
    for (i = 0, e = parChildren.length; i < e; i++) {
        tmpArr.push(parChildren[i]);
    }

    for (i = 0; i < e; i++) {
        container.removeChild(tmpArr[i]);
    }
    container.innerHtml ="";
}

function ulDropDownMenu () {
	var ul = document.createElement('ul');
/*	ul.id = "dropdown";
	
    tracksMenuItems.forEach(function (item) {
		var li = document.createElement('li');
		li.textContent = item;
		ul.appendChild (li);
	});
*/
	return ul;
}

function renderAlbumTracks(tracks) {
    cleanLibrayContainer();

	changeLibraryBrowserTitle (currentAlbumTitle);

    var oldContainer = document.getElementById('library-container');
    var newContainer = oldContainer.cloneNode(false);

    var i = 0;

    var table = document.createElement('table');
    table.className ="table table-hover";
    table.id="mt";
    var thead = document.createElement('thead');
    var tbody = document.createElement('tbody');
    var tr1 = document.createElement('tr');

	var li_root = document.createElement('th');
	li_root.id = "albumTrack";
	li_root.dataset.title = 'CompleteAlbum';

    li_root.dataset.uri = '';
    //li_root.dataset.uri = '*';//GF

	var title_root = document.createElement('p');
	title_root.className = 'title';
	title_root.textContent = "Complete Album (" + (tracks.length -1) + " tracks)";

    tracks.forEach(function (track) {
	var li = document.createElement('li');
	li.id = "albumTrack";
	li.dataset.title = track.title;
	li.dataset.uri = track.uri;

	//var trackInfo = document.createElement('div');
	var trackInfo = document.createElement('td');
	trackInfo.id = "albumTrack"; 
	trackInfo.dataset.title = track.title;
	trackInfo.dataset.uri = track.uri;

	if (i > 0) {
	    li_root.dataset.alltitle = li_root.dataset.alltitle+','+track.title;//GF
	    li_root.dataset.uri = li_root.dataset.uri+','+track.uri;//GF
	}
	else {
	    li_root.dataset.alltitle = track.title;
	    li_root.dataset.uri = track.uri;
	}

	var title = document.createElement('p');
	title.className = 'title';
	if (i < 9) {
	    title.textContent = '0';
	}
	title.textContent += (i+1)+' '+track.title;
	trackInfo.appendChild(title);
	var artist = document.createElement('p');
	artist.className = 'artist';
	artist.textContent = track.artist;
//	trackInfo.appendChild(artist);

	if (i == 0) {
		var albumArt = document.createElement('img');
		albumArt.src = track.albumArtURI;
		li_root.appendChild(albumArt);
		li_root.appendChild(title_root);
	    tr1.appendChild (li_root);
	    tbody.appendChild (tr1); 
	}

	li.tabIndex = i++;

	var tr = document.createElement('tr');
	tr.appendChild (trackInfo);
	tbody.appendChild (tr);

    });

/*
	var li = document.createElement('li');
	li.id = "albumTrack";
	li.dataset.title = "test";
	li.dataset.uri = "http://192.168.1.30/mp3_content/L7/L7,%20Bordeaux,%20Rockschool%20Barbey,%2001.07.1997/15%20Piste%2015.mp3";

	//var trackInfo = document.createElement('div');
	var trackInfo = document.createElement('td');
	trackInfo.id = "albumTrack"; 
	trackInfo.dataset.title = "test";
	trackInfo.dataset.uri = "http://192.168.1.30/mp3_content/L7/L7,%20Bordeaux,%20Rockschool%20Barbey,%2001.07.1997/15%20Piste%2015.mp3";
	var title = document.createElement('p');
	title.className = 'title';
	if (i < 9) {
	    title.textContent = '0';
	}
	title.textContent += (i+1)+' test';
	trackInfo.appendChild(title);
	var artist = document.createElement('p');
	artist.className = 'artist';
	artist.textContent = track.artist;
//	trackInfo.appendChild(artist);

	if (i == 0) {
		var albumArt = document.createElement('img');
		albumArt.src = track.albumArtURI;
		li_root.appendChild(albumArt);
		newContainer.appendChild(li_root);
		li_root.appendChild(title_root);
	}

	li.tabIndex = i++;

	var tr = document.createElement('tr');
	tr.appendChild (trackInfo);
	tbody.appendChild (tr);
*/



    table.appendChild (tbody);
    newContainer.appendChild(table);
    oldContainer.parentNode.replaceChild(newContainer, oldContainer);
}

function renderRootLibraryMenu(data) {
    cleanLibrayContainer();

	changeLibraryBrowserTitle ('Select a Music Source');

    var oldContainer = document.getElementById('library-container');
    var newContainer = oldContainer.cloneNode(false);

    var i = 0;
    rootLibraryMenuItems.forEach(function (item) {
	var li = document.createElement('li');

	var icon = document.createElement('img');
	icon.src = rootLibraryMenuIcons[i];

	var span = document.createElement('span');
	span.textContent = item;
	li.appendChild(icon);
	li.appendChild(span);
	newContainer.appendChild(li);
	i++;
    });

    oldContainer.parentNode.replaceChild(newContainer, oldContainer);
}

function renderQueue(queue) {
	var tempContainer = document.createDocumentFragment();
	var trackIndex = queue.startIndex + 1;
	var scrollTimeout;

	queue.items.forEach(function (q) {
		var li = document.createElement('li');
		li.dataset.title = q.uri;
		li.dataset.trackNo = trackIndex++;
		li.tabIndex = trackIndex;

		var albumArt = document.createElement('img');
		//albumArt.src = q.albumArtURI;
		albumArt.dataset.src = q.albumArtURI;
		if (trackIndex < 20) {
			albumArt.src = q.albumArtURI;
			albumArt.className = "loaded";
		}

		li.appendChild(albumArt);

		var trackInfo = document.createElement('div');
		var title = document.createElement('p');
		title.className = 'title';
		title.textContent = q.title;
		trackInfo.appendChild(title);
		var artist = document.createElement('p');
		artist.className = 'artist';
		artist.textContent = q.artist;
		trackInfo.appendChild(artist);

		li.appendChild(trackInfo);
		tempContainer.appendChild(li);
	});

	var oldContainer = document.getElementById('queue-container');
	if (queue.startIndex == 0) {
		// This is a new queue
		var newContainer = oldContainer.cloneNode(false);
		newContainer.addEventListener('scroll', function (e) {
			clearTimeout(scrollTimeout);
			var _this = this;
			scrollTimeout = setTimeout(function () {
				lazyLoadImages(_this);
			},150);

		});
		newContainer.appendChild(tempContainer);
		oldContainer.parentNode.replaceChild(newContainer, oldContainer);
	} else {
		// This should be added! we assume they come in the correct order
		oldContainer.appendChild(tempContainer);

	}
}

function lazyLoadImages(container) {
	// Find elements that are in viewport
	var containerViewport = container.getBoundingClientRect();
	// best estimate of starting point
	var trackHeight = container.firstChild.scrollHeight;

	// startIndex
	var startIndex = Math.floor(container.scrollTop / trackHeight);
	var currentNode = container.childNodes[startIndex];

	while (currentNode && currentNode.getBoundingClientRect().top < containerViewport.bottom) {
		var img = currentNode.firstChild;
		currentNode = currentNode.nextSibling;
		if (img.className == 'loaded') {
			continue;
		}

		// get image
		img.src = img.dataset.src;
		img.className = 'loaded';

	}

}
