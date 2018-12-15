/*\
title: $:/plugins/OokTech/Bob/action-convertwiki.js
type: application/javascript
module-type: widget

Action widget to take an input html file and split it into a node wiki

<$action-convertwiki $fileInput='#fileInput'/>

where #fileInput is the name given to the file input html element used.

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var ActionConvertWiki = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
};

/*
Inherit from the base widget class
*/
ActionConvertWiki.prototype = new Widget();

/*
Render this widget into the DOM
*/
ActionConvertWiki.prototype.render = function(parent,nextSibling) {
	this.computeAttributes();
	this.execute();
};

/*
Compute the internal state of the widget
*/
ActionConvertWiki.prototype.execute = function() {
	this.inputName = this.getAttribute('fileInput', "#fileInput");
  this.wikiFolder = this.getAttribute('wikiFolder', undefined);
  this.wikisPath = this.getAttribute('wikisPath', undefined);
  this.wikiName = this.getAttribute('wikiName', undefined);
  this.overwrite = this.getAttribute('overwrite', undefined);
};

/*
Refresh the widget by ensuring our attributes are up to date
*/
ActionConvertWiki.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();
	if(Object.keys(changedAttributes).length) {
		this.refreshSelf();
		return true;
	}
	return this.refreshChildren(changedTiddlers);
};

/*
Invoke the action associated with this widget
*/
ActionConvertWiki.prototype.invokeAction = function(triggeringWidget,event) {
  var self = this;
  // Find the file input html element, get the file from that.
  var fileElement = document.getElementById(this.inputName);
  if (fileElement) {
    var file = fileElement.files[0];
    var wikiName = $tw.wiki.getTiddlerText("$:/WikiName");
    // Read the file and pass it to the parsing stuff
    if (file) {
      $tw.wiki.readFileContent(file, file.type, false, undefined, function (output) {
        if (output.length > 0) {
          var token = localStorage.getItem('ws-token')
          var message = {
            "type": "newWikiFromTiddlers",
            "tiddlers": output,
            "wikisPath": self.wikisPath,
            "wikiName": self.wikiName,
            "wikiFolder": self.wikiFolder,
            "token": token,
            "wiki": wikiName,
            "overwrite": self.overwrite
          }
          $tw.connections[0].socket.send(JSON.stringify(message));
        } else {
          console.log("No tiddlers found in input file!");
        }
      })
    }
  	return true; // Action was invoked
  }
};

exports["action-convertwiki"] = ActionConvertWiki;

})();