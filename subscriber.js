// PixlServer Unbase Subscriber
// Copyright (c) 2018 Joseph Huckaby
// Released under the MIT License

var util = require("util");
var async = require('async');
var Class = require("pixl-class");
var Tools = require("pixl-tools");

function noop() {};

module.exports = Class.create({
	
	__name: "UnbaseSub",
	
	id: null,
	view: null,
	
	__construct: function(opts) {
		// class constructor
		// opts: { index_key, index, query, orig_query, sort_by, sort_dir, [sort_type], offset, limit }
		Tools.mergeHashInto( this, opts || {} );
		
		// prevent 'error' events from crashing node
		this.on('error', noop);
	},
	
	init: function(server) {
		// initialize and attach to server
		this.server = server;
		this.logger = server.logger;
		this.storage = server.Storage;
		this.unbase = server.Unbase;
		
		this.logDebug(6, "Creating new subscriber", { query: this.orig_query });
	},
	
	notifyChange: function() {
		// our linked search results have changed
		// regenerate our offset/limit chunk and emit change event
		var self = this;
		var offset = this.offset;
		var limit = this.limit;
		var sort_pairs = this.view.sort_pairs;
		var sorted_ids = [];
		
		for (var idx = 0, len = Math.min(limit, sort_pairs.length); idx < len; idx++) {
			sorted_ids.push( sort_pairs[idx + offset][0] );
		}
		
		this.logDebug(8, "Loading " + limit + " records at position " + offset, this.debugLevel(10) ? sorted_ids : null );
		
		this.unbase.getRecords( this.index_key, sorted_ids, function(err, records) {
			if (err) {
				var err_msg = "Failed to fetch records: " + err;
				self.logError('storage', err_msg);
				self.emit('error', err_msg);
				return;
			}
			
			self.emit('change', {
				records: records,
				total: sort_pairs.length
			});
		} );
	},
	
	changeOptions: function(opts) {
		// change offset/limit and refresh
		this.logDebug(8, "Subscriber changing search options", opts);
		Tools.mergeHashInto( this, opts || {} );
		this.notifyChange();
	},
	
	unsubscribe: function() {
		// client is done with us
		this.logDebug(6, "Unsubscribing from view");
		this.view.removeSubscriber(this);
	},
	
	debugLevel: function(level) {
		// check if we're logging at or above the requested level
		return (this.logger.get('debugLevel') >= level);
	},
	
	logDebug: function(level, msg, data) {
		// proxy request to system logger with correct component
		if (!data) data = {};
		data.id = this.id;
		data.index = this.index_key;
		this.logger.set( 'component', this.__name );
		this.logger.debug( level, msg, data );
	},
	
	logError: function(code, msg, data) {
		// proxy request to system logger with correct component
		if (!data) data = {};
		data.id = this.id;
		data.index = this.index_key;
		this.logger.set( 'component', this.__name );
		this.logger.error( code, msg, data );
	}
	
}); // class
