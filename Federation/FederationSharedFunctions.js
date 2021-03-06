/*\
title: $:/plugins/OokTech/Bob/Federation/FederationSharedFunctions.js
type: application/javascript
module-type: startup

This has some functions that are needed by Bob in different places.

\*/
(function () {

  /*jslint node: true, browser: true */
  /*global $tw: false */
  "use strict";

  // Export name and synchronous status
  exports.name = "federation-shared-functions";
  exports.platforms = ["node"];
  exports.after = ["render"];
  exports.synchronous = true;

  if($tw.node && $tw.settings.enableFederation === 'yes') {

    let idNumber = 0;
    let messageQueue = [];
    let messageQueueTimer = false;

    $tw.Bob = $tw.Bob || {};
    $tw.Bob.Federation = $tw.Bob.Federation || {};
    $tw.Bob.Federation.remoteConnections = $tw.Bob.Federation.remoteConnections || {};
    $tw.Bob.Federation.nonce = $tw.Bob.Federation.nonce || [];
    $tw.settings.federation = $tw.settings.federation || {};
    $tw.settings.advanced = $tw.settings.advanced || {};


    /*
      messageQueue [messageData]
      messageData {
        message: message,
        time: original sending timestamp,
        ctime: the time when all active connections have given an ack (for pruning old messages)
        id: messageId,
        ack: ackObject,
        type: messageType
      }
      ackObject {
        index: ackReceived,
        index2: ackReceived2
      }

      message - the json object that is actually sent as the message.
      time - the time the messageData is created
      id - the message id (should be unique per-session)
      ack - an object that holds each connection that the message is sent to and
        if an ack has been received or not yet
      title - for messages that refer to a tiddler this is the tiddler title,
        otherwise it is undefined.
      type - the message type

      for the ackObject the index is the connection index and ackReceived is a
      boolean indicating if the ack has been received yet or not.
    */
    function createMessageData(message) {
      message.id = makeId();
      let messageData = {
        message: message,
        id: id,
        time: Date.now(),
        type: message.type,
        ack: {}
      };
      return messageData;
    }

    /*
      This function checks the message queue to see if anything should be done.

      It first checks to see if there are any messages in the message queue, if
      not than it does nothing other than removing the timer to recheck the
      queue. The timer is restarted elsewhere if a message is sent.

      It then prunes the message queue, removing any messages that have been
      send and acknoweldeged so there is nothing more to do with them.

      It then checks any remaining messages to check if there are any that are
      older than 500ms.
      These messages are assumed to have been missed by the other end and are
      resent.

      If the queue isn't empty the timeout is reset for this function to run
      again in 500ms
    */
    function checkMessageQueue() {
      // If the queue isn't empty
      if(messageQueue.length > 0) {
        // Remove messages that have already been sent and have received all
        // their acks and have waited the required amonut of time.
        messageQueue = pruneMessageQueue(messageQueue);
        // Check if there are any messages that are more than 500ms old and have
        // not received the acks expected.
        // These are assumed to have been lost and need to be resent
        const oldMessages = messageQueue.filter(function(messageData) {
          if(Date.now() - messageData.time > $tw.settings.advanced.federatedMessageQueueTimeout || 500) {
            return true;
          } else {
            return false;
          }
        });
        oldMessages.forEach(function (messageData) {
          // If we are in the browser there is only one connection, but
          // everything here is the same.
          Object.keys($tw.Bob.Federation.remoteConnections).forEach(function(index) {
            // Here make sure that the connection is live and hasn't already
            // sent an ack for the current message.
            if($tw.Bob.Federation.remoteConnections[index].socket !== undefined) {
              if(!messageData.ack[index] && $tw.Bob.Federation.remoteConnections[index].socket.readyState === 1) {
                // If we haven't received an ack from this connection yet than
                // resend the message
                sendMessage(messageData, index)
              }
            }
          });
        });
        if(messageQueueTimer) {
          clearTimeout(messageQueueTimer);
        }
        messageQueueTimer = setTimeout(checkMessageQueue, $tw.settings.advanced.federatedMessageQueueTimeout || 500);
      } else {
        clearTimeout(messageQueueTimer);
        messageQueueTimer = false;
      }
    }

    /*
      This returns a new id for a message.
      Federated message ids start with f, the same counter is used for every
      server.
    */
    function makeId() {
      idNumber = idNumber + 1;
      const newId = 'f' + idNumber;
      return newId;
    }

    /*
      This takes a new message and a message queue.

      It returns an updated queue that has any messages made irrelevant by the
      new message removed.

      Irrelevant messages are defined as:

      - any message that has the same id as the new message
      - any message that are an exact copy of the new message
    */
    function removeRedundantMessages(messageData, queue) {
      // Get a list of any duplicate messages or any that are now redundant
      // because of the new message.
      const duplicateIndicies = queue.map(function(item, index) {
        // Messages with the same id are the same message and not considered
        // redudant here. There are other checks to make sure that the same
        // message isn't enqueued twice.
        // This is needed here or we lose the ack state of our connections if we
        // send the same message to multiple connections.
        if(messageData.id === item.id) {
          return -1;
        }

        // Finally if it isn't any of the basic messages check to see if the
        // message is a direct duplicate of an existing message.
        // match lists all the keys in message that don't have the same value in
        // item.message and all the keys in item.message that don't have the same
        // value in message.
        // If match has any elements in it than they are different messages.
        const match = Object.keys(messageData.message).filter(function(key) {
          return (messageData.message[key] !== item.message[key])
        }).concat(Object.keys(item.message).filter(function(key) {
          return (messageData.message[key] !== item.message[key])
        }));
        if(match.length === 0) {
          return index;
        }
        // If none of the above returned than there is no match.
        return -1;
      }).filter(function(item) {return item > -1;});
      // Remove the messages that are overruled by the new message.
      const outQueue = queue.filter(function(item, index) {
        return duplicateIndicies.indexOf(index) < 0;
      });
      // return the new queue
      return outQueue;
    }

    /*
      This checks if a message is eligable to be sent and returns a boolean
      value true means the message should be sent or stored and false means it
      shouldn't.

      This checks:

      - if the message data and connectionIndex are defined
      - if the remote connection info exists
      - if the socket for the remote connection exists and is open

      TODO figure out what else to put here
    */
    function messageIsEligible(messageData, connectionIndex, queue) {
      if (!messageData || (!connectionIndex && connectionIndex !== 0)) {
        return false;
      }
      if(!$tw.Bob.Federation.remoteConnections[connectionIndex]) {
        return false;
      }
      if(!$tw.Bob.Federation.remoteConnections[connectionIndex].socket) {
        return false;
      }
      if($tw.Bob.Federation.remoteConnections[connectionIndex].socket.readyState !== 1) {
        return false;
      }
      // Make sure that the queue exists. This may be over paranoid
      queue = queue || [];

      // Start out saying that a message shouldn't be sent
      let send = false;

      let ignore = false;
      // I am not sure what conditions we have where we should ignore a
      // messaege.
      // I think to start the only one is if the same message is already in
      // the queue.
      if(!ignore) {
        send = true;
      }
      return send;
    }

    /*
      This sends the message described by messageData to the connection
      indicated by connectionIndex, if appropriate.

      First the message is checked to make sure it is eligible to be send using
      messageIsEligible, if it isn't than nothing is sent but the messageQueue
      timer is still reset.

      If the message is eligible to be sent than the message queue is checked
      any existing messages that the current message makes redundant are
      removed from the queue. Note that the same message (that is the direct
      duplicate with the same messageId) is not removed here, if it were than
      the same message being sent from the server to multiple browsers would
      overwrite the ack state of each browser as the message was sent to the
      next one.

      Then the queue is checked to see if the same message is already enqueued,
      if so than only the ack state is updated so it is waiting for an ack from
      the current connectionIndex. If the message is not already enqueued than
      the ack state is updated in the messageData and it is added to the queue.

      This modifies messageQueue as a side effect
    */
    function sendMessage(messageData, connectionIndex) {
      if (!messageData || (!connectionIndex && connectionIndex !== 0)) {
        return;
      }
      if(messageIsEligible(messageData, connectionIndex, messageQueue)) {
        $tw.Bob.Timers = $tw.Bob.Timers || {};
        connectionIndex = connectionIndex || 0;

        // Remove any messages made redundant by this message
        messageQueue = removeRedundantMessages(messageData, messageQueue);
        // Check to see if the token has changed
        messageQueue = removeOldTokenMessages(messageQueue);
        // If the message is already in the queue (as determined by the message
        // id), than just add the new target to the ackObject
        const enqueuedIndex = Object.keys(messageQueue).findIndex(function(enqueuedMessageData) {
          return enqueuedMessageData.id === messageData.id;
        });
        if(enqueuedIndex !== -1) {
          messageQueue[enqueuedIndex].ack[connectionIndex] = false;
        } else {
          // If the message isn't in the queue set the ack status for the
          // current connectionIndex and enqueue the message
          messageData.ack[connectionIndex] = false;
          messageQueue.push(messageData);
        }
        $tw.Bob.Federation.remoteConnections[connectionIndex].socket.send(JSON.stringify(messageData.message));
      }
      clearTimeout(messageQueueTimer);
      //messageQueueTimer = setTimeout(checkMessageQueue, $tw.settings.advanced.federatedMessageQueueTimeout || 1500);
    }

    /*
      If the token in the queued messages changes than remove messages that use
      the old token
    */
    function removeOldTokenMessages(messageQueue) {
      // TODO this!!
      return messageQueue
    }

    /*
      This is the function for handling ack messages on both the server and
      browser. It is the same on both sides so it is here to prevent duplicate
      code.

      It takes a messadeData object as input and checks it against the message
      queue. If the queue contains a message with the same id as node input
      messageData than the ack state for the connection the ack came from is set
      to true.

      If all acks for the messageData in the queue are set to true than the ctime
      for that messageData is set to the current time so it can be properly
      removed later.
    */
    function handleAck(data) {
      if(data.id) {
        // a quick hack to make this work
        if($tw.browser) {
          data.source_connection = 0;
        }
        const index = messageQueue.findIndex(function(messageData) {
          return messageData.id === data.id;
        })
        if(messageQueue[index]) {
          // Set the message as acknowledged.
          messageQueue[index].ack[data.source_connection] = true;
          // Check if all the expected acks have been received
          const complete = Object.keys(messageQueue[index].ack).findIndex(function(value){
            return messageQueue[index].ack[value] === false;
          }) === -1;
          // If acks have been received from all connections than set the ctime.
          if(complete && !messageQueue[index].ctime) {
            messageQueue[index].ctime = Date.now();
          }
        }
      }
    }

    function getAccessToken(connectionKey) {
      return false;
    }

    /*
      This takes a messageQueue as input and returns a queue with old messages
      removed.

      As part of the ack handling, once a message receives an ack from every
      connection it is sent to the ctime is set.
      This checks each message in the queue and if the ctime exists and is more
      than 10000ms old than it removes the message from the returned queue.

      A message is kept past the final ack because some messages can be sent
      multiple times and things get stuck in an infinite loop if we don't detect
      that they are duplicates.
    */
    function pruneMessageQueue(inQueue) {
      inQueue = inQueue || [];
      // We can not remove messages immediately or else they won't be around to
      // prevent duplicates when the message from the file system monitor comes
      // in.
      // But we don't want a huge history of messages taking up all the ram, so
      // we set some long time to live on the message queue and remove any
      // messages older than this TTL when we receive a new ack.
      // remove the message with the id from the message queue
      // try removing messages that received an ack more than 10 seconds ago.

      // messageData.ack.ctime is the time that a message received all the acks
      // it was waiting for. If it doesn't exist than it is still waiting.
      const outQueue = inQueue.filter(function(messageData) {
        const token = getAccessToken()
        if((token && messageData.message.token && messageData.message.token !== token) || (token && !messageData.message.token) ) {
          // If we have a token, the message has a token and they are not the
          // same than drop the message. (possible imposter)
          // If we have a token and the message doesn't have a token than drop it
          // (someone unathenticated trying to make changes)
          // If we don't have a token and the message does than what?
          return false
        } else if(messageData.ctime) {
          // if there is a ctime than check if it is more than 10000ms ago, if so
          // remove the message.
          if(Date.now() - messageData.ctime > 10000) {
            return false;
          } else {
            return true;
          }
        } else {
          return true;
        }
      })
      return outQueue;
    }

    /*
      This acknowledges that a message has been received.
    */
    $tw.Bob.Federation.sendAck = function (data) {
      data = data || {};
      if($tw.browser) {
        const token = localStorage.getItem('ws-token')
        $tw.Bob.Federation.remoteConnections[0].socket.send(JSON.stringify({type: 'ack', id: data.id, token: token, wiki: $tw.wikiName}));
      } else {
        if(data.id) {
          if(data.source_connection !== undefined && data.source_connection !== -1) {
            $tw.Bob.Federation.remoteConnections[data.source_connection].socket.send(JSON.stringify({type: 'ack', id: data.id}));
          }
        }
      }
    }

    /*
      This creates the needed message data for remote servers

      TODO get access token part
      TODO make the nonce not terrible
    */
    function createRemoteMessageData(message, wiki) {
      if(typeof message === 'string') {
        try{
          message = JSON.parse(message);
        } catch (e) {
          console.log('err', e);
          return false;
        }
      }
      // The nonce is used for some privacy and to keep track of what wikis
      // messages are for. With the proper implementation it could also be used
      // for security, but the Math.random function isn't cryptographically
      // secure so this isn't the proper implementation.
      const nonce = Math.random()*99999999999999
      // The messages ids are shared with sending things to browsers, but this
      // has no effect on anything other than making the numbers increase a bit
      // faster.
      const id = makeId();
      const token = false;
      message.id = id;
      message.rnonce = nonce;
      let messageData = {
        message: message,
        id: id,
        time: Date.now(),
        type: message.type,
        ack: {},
        token: token
      };
      const server = (typeof wiki === 'undefined')?true:false;
      $tw.Bob.Federation.nonce.push({nonce: nonce, wiki: wiki, server: server, type: message.type})
      return messageData;
    }

    /*
      This sends a message to a remote server. This is used for syncing for now,
      in the future it may be used for other things.
    */
    $tw.Bob.Federation.sendToRemoteServer = function(message, serverKey, wiki) {
      const messageData = createRemoteMessageData(message, wiki);
      if (messageData && (serverKey || serverKey === 0)) {
        //console.log('message data:',messageData)
        // This sends the message. The sendMessage function adds the message to
        // the queue if appropriate.
        sendMessage(messageData, serverKey);
      } else {
        // log something here console.log
      }
    }

    /*
      TODO figure out how to best specify which servers to send the message to
    */
    $tw.Bob.Federation.sendToRemoteServers = function(message) {
      //console.log('sendToRemoteServers')
      //console.log(message)
      // Don't send to the server that the message originated in!
      // but that shouldn't happen
      //console.log(Object.keys($tw.Bob.Federation.remoteConnections))
      Object.keys($tw.Bob.Federation.remoteConnections).forEach(function(serverKey) {
        $tw.Bob.Federation.sendToRemoteServer(message, serverKey);
      })
    }
  }

})();
