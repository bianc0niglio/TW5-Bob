/*\
title: $:/plugins/OokTech/MultiUser/NodeMessageHandlers.js
type: application/javascript
module-type: startup

These are message handler functions for the web socket servers. Use this file
as a template for extending the web socket funcitons.

This handles messages sent to the node process.
\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

// This lets you add to the $tw.nodeMessageHandlers object without overwriting
// existing handler functions
$tw.nodeMessageHandlers = $tw.nodeMessageHandlers || {};
// Ensure that the browser tiddler list object exists without overwriting an
// existing copy.
$tw.BrowserTiddlerList = $tw.BrowserTiddlerList || {};

/*
  This handles when the browser sends the list of all tiddlers that currently
  exist in the browser version of the wiki. This is different than the list of
  all tiddlers in files.
*/
$tw.nodeMessageHandlers.browserTiddlerList = function(data) {
  // Save the list of tiddlers in the browser as part of the $tw object so it
  // can be used elsewhere.
  $tw.BrowserTiddlerList[data.source_connection] = data.titles;
}

/*
  This is just a test function to make sure that everthing is working.
  It displays the contents of the received data in the console.
*/
$tw.nodeMessageHandlers.test = function(data) {
  console.log(data);
}

/*
  This responds to a ping from the browser. This is used to check and make sure
  that the browser and server are connected.
*/
$tw.nodeMessageHandlers.ping = function(data) {
  // When the server receives a ping it sends back a pong.
  var response = JSON.stringify({'type': 'pong'});
  $tw.connections[data.source_connection].socket.send(response);
}

/*
  This handles saveTiddler messages sent from the browser.

  TODO: Determine if we always want to ignore draft tiddlers.
*/
$tw.nodeMessageHandlers.saveTiddler = function(data) {
  // Make sure there is actually a tiddler sent
  if (data.tiddler) {
    // Make sure that the tiddler that is sent has fields
    if (data.tiddler.fields) {
      // Ignore draft tiddlers
      if (!data.tiddler.fields['draft.of']) {
        // Set the saved tiddler as no longer being edited. It isn't always
        // being edited but checking eacd time is more complex than just always
        // setting it this way and doesn't benifit us.
        $tw.nodeMessageHandlers.cancelEditingTiddler({data:data.tiddler.fields.title});
        // Make sure that the waitinhg list object has an entry for this
        // connection
        $tw.MultiUser.WaitingList[data.source_connection] = $tw.MultiUser.WaitingList[data.source_connection] || {};
        // Check to see if we are expecting a save tiddler message from this
        // connection for this tiddler.
        if (!$tw.MultiUser.WaitingList[data.source_connection][data.tiddler.fields.title]) {
          // If we are not expecting a save tiddler event than save the tiddler
          // normally.
          console.log('Node Save Tiddler');
          if (!$tw.boot.files[data.tiddler.fields.title]) {
            $tw.syncadaptor.saveTiddler(data.tiddler);
          } else {
            // If changed send tiddler
            var tiddlerObject = $tw.loadTiddlersFromFile($tw.boot.files[data.tiddler.fields.title].filepath);
            var changed = $tw.syncadaptor.TiddlerHasChanged(data.tiddler, tiddlerObject);
            if (changed) {
              $tw.syncadaptor.saveTiddler(data.tiddler);
            }
          }
        } else {
          // If we are expecting a save tiddler message than it is the browser
          // acknowledging that it received the update and we remove the entry
          // from the waiting list.
          // This is very important, without this it gets stuck in infitine
          // update loops.
          $tw.MultiUser.WaitingList[data.source_connection][data.tiddler.fields.title] = false;
        }
      }
    }
  }
}

/*
  This is the handler for when the browser sends the deleteTiddler message.
*/
$tw.nodeMessageHandlers.deleteTiddler = function(data) {
  console.log('Node Delete Tiddler');
  // Delete the tiddler file from the file system
  $tw.syncadaptor.deleteTiddler(data.tiddler);
  // Remove the tiddler from the list of tiddlers being edited.
  if ($tw.MultiUser.EditingTiddlers[data.tiddler]) {
    delete $tw.MultiUser.EditingTiddlers[data.tiddler];
    $tw.MultiUser.UpdateEditingTiddlers(false);
  }
}

/*
  This is the handler for when a browser sends the editingTiddler message.
*/
$tw.nodeMessageHandlers.editingTiddler = function(data) {
  console.log('Editing Tiddler');
  // Add the tiddler to the list of tiddlers being edited to prevent multiple
  // people from editing it at the same time.
  $tw.MultiUser.UpdateEditingTiddlers(data.tiddler);
}

/*
  This is the handler for when a browser stops editing a tiddler.
*/
$tw.nodeMessageHandlers.cancelEditingTiddler = function(data) {
  console.log('Cancel Editing Tiddler');
  // This is ugly and terrible and I need to make the different soures of this
  // message all use the same message structure.
  if (typeof data.data === 'string') {
    if (data.data.startsWith("Draft of '")) {
      var title = data.data.slice(10,-1);
    } else {
      var title = data.data;
    }
  } else {
    if (data.tiddler.startsWith("Draft of '")) {
      var title = data.tiddler.slice(10,-1);
    } else {
      var title = data.tiddler;
    }
  }
  // Remove the current tiddler from the list of tiddlers being edited.
  if ($tw.MultiUser.EditingTiddlers[title]) {
    delete $tw.MultiUser.EditingTiddlers[title];
    $tw.MultiUser.UpdateEditingTiddlers(false);
  }
}

})()
