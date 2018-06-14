// PixlServer Unbase View
// Copyright (c) 2018 Joseph Huckaby
// Released under the MIT License

var util = require("util");
var async = require('async');
var Class = require("pixl-class");
var Tools = require("pixl-tools");

function noop() {};

module.exports = Class.create({
	
	__name: "UnbaseView",
	
	subs: null,
	results: null,
	sort_pairs: null,
	comparator: null,
	
	__construct: function(opts) {
		// class constructor
		// opts: { index_key, index, search_id, query, orig_query, sort_by, sort_dir, [sort_type] }
		Tools.mergeHashInto( this, opts || {} );
		
		// don't need these at the view level (handled at the sub level)
		delete this.offset;
		delete this.limit;
	},
	
	init: function(server) {
		// initialize and attach to server
		this.server = server;
		this.logger = server.logger;
		this.storage = server.Storage;
		this.unbase = server.Unbase;
		this.subs = {};
		
		this.logDebug(6, "Creating new view", { query: this.orig_query });
		this.search();
	},
	
	search: function() {
		// perform initial search
		var self = this;
		this.logDebug(8, "Performing initial search for view");
		
		this.storage.searchRecords( this.query, this.index, function(err, results) {
			if (err) {
				// emit error, kill view
				var err_msg = "Initial search failed: " + err;
				self.logError('search', err_msg);
				self.broadcast('error', err_msg);
				self.destroy();
				return;
			}
			
			var finish = function(err, sorted_ids, sort_pairs, comparator) {
				if (err) {
					// emit error, kill view
					var err_msg = "Initial search failed: " + err;
					self.logError('search', err_msg);
					self.broadcast('error', err_msg);
					self.destroy();
					return;
				}
				
				// store sort positions (idx) inside results hash, for quick cross-refs
				for (var idx = 0, len = sort_pairs.length; idx < len; idx++) {
					var pair = sort_pairs[idx];
					results[ pair[0] ] = idx;
				}
				
				// everybody into ram!
				self.results = results;
				self.sort_pairs = sort_pairs;
				self.comparator = comparator;
				
				// now emit an update to all subs
				self.notifyChange();
				
			}; // finish
			
			if (self.sort_by == '_id') {
				// natural ID sort (fast)
				var comparator = (self.sort_type == 'number') ?
					function(a, b) { return (parseFloat(a[1]) - parseFloat(b[1])) * self.sort_dir; } :
					function(a, b) { return a[1].toString().localeCompare( b[1] ) * self.sort_dir; };
				
				var sort_pairs = [];
				for (var record_id in results) {
					sort_pairs.push([ record_id, record_id ]);
				}
				sort_pairs.sort( comparator );
				
				finish( null, [], sort_pairs, comparator );
			}
			else {
				// sorter sort (slow)
				self.storage.sortRecords( results, self.sort_by, self.sort_dir, self.index, finish );
			}
			
		} ); // searchRecords
	},
	
	update: function(state) {
		// update view after indexer insert/update
		// state: { action, idx_data, id, new_record, changed }
		var record_id = state.id;
		
		if (state.action == 'insert') {
			// record was inserted or updated
			// either way, we need to know if it matches our search now
			var old_hit = this.results.hasOwnProperty(record_id);
			var temp_results = this.storage._searchSingle(this.query, record_id, state.idx_data, this.index);
			var new_hit = temp_results.hasOwnProperty(record_id);
			
			if (!old_hit && new_hit) {
				// add record to our search results
				this.addRecord(state);
			}
			else if (old_hit && !new_hit) {
				// remove record from our search results
				this.removeRecord(state);
			}
			else if (old_hit && new_hit && (this.sort_by != '_id')) {
				// record is already in our set and was updated
				// see if sort order has changed
				var old_sort_value = this.sort_pairs[ this.results[record_id] ][1];
				var new_sort_value = state.idx_data._sorters[ this.sort_by ];
				if (new_sort_value != old_sort_value) {
					// yup, sure has
					this.logDebug(9, "Record " + record_id + " sort order has changed, resorting", {
						old: old_sort_value,
						new: new_sort_value
					});
					this.sort_pairs[ this.results[record_id] ][1] = new_sort_value;
					this.resortAndNotify();
				}
				else {
					// still may need to notify some subs, if the updated record is within their offset/limit
					var record_idx = this.results[record_id];
					this.notifyVisible( record_idx );
				}
			}
			else if (old_hit && new_hit) {
				// still may need to notify some subs, if the updated record is within their offset/limit
				var record_idx = this.results[record_id];
				this.notifyVisible( record_idx );
			}
			else {
				this.logDebug(10, "Record change does not concern us: " + record_id);
			}
		}
		else if (state.action == 'delete') {
			// record was deleted
			// see if this affects us
			var old_hit = this.results.hasOwnProperty(record_id);
			if (old_hit) {
				// remove record from our search results
				this.removeRecord(state);
			}
		}
	},
	
	addRecord: function(state) {
		// add record to our search result set,
		// then resort, then notify subs of change
		var record_id = state.id;
		var sort_value = (this.sort_by == '_id') ? record_id : state.idx_data._sorters[ this.sort_by ];
		this.logDebug(8, "Adding record to our result set: " + record_id, { sort_value: sort_value });
		
		this.results[ record_id ] = 1;
		this.sort_pairs.push([ record_id, sort_value ]);
		
		this.resortAndNotify();
	},
	
	removeRecord: function(state) {
		// remove record from our search result set,
		// then resort, then notify subs of change
		var record_id = state.id;
		var sort_idx = this.results[record_id];
		this.logDebug(8, "Removing record from our result set: " + record_id);
		
		delete this.results[ record_id ];
		this.sort_pairs.splice( sort_idx, 1 );
		
		this.resortAndNotify();
	},
	
	resortAndNotify: function() {
		// resort results after a change, then notify subs
		this.sort_pairs.sort( this.comparator );
		
		// store sort positions (idx) inside results hash, for quick cross-refs
		for (var idx = 0, len = this.sort_pairs.length; idx < len; idx++) {
			var pair = this.sort_pairs[idx];
			this.results[ pair[0] ] = idx;
		}
		
		this.notifyChange();
	},
	
	notifyChange: function() {
		// notify all subs that a search change has taken place
		// load all unique records once, using storage concurrency,
		// then distribute appropriate records (offset/limit) to each sub
		var self = this;
		if (!Tools.numKeys(this.subs)) return;
		
		this.logDebug(9, "Notifying all subscribers that a change has occurred");
		
		var record_map = {};
		var sort_pairs = this.sort_pairs;
		
		for (var key in this.subs) {
			var sub = this.subs[key];
			for (var idx = 0, len = Math.min(sub.limit, sort_pairs.length); idx < len; idx++) {
				record_map[ sort_pairs[idx + sub.offset][0] ] = 1;
			}
		}
		
		var record_ids = Object.keys(record_map);
		
		this.logDebug(8, "Loading " + record_ids.length + " records" );
		
		this.unbase.getRecords( this.index_key, record_ids, function(err, records) {
			if (err) {
				var err_msg = "Failed to fetch records: " + err;
				self.logError('storage', err_msg);
				return;
			}
			
			// copy loaded records back into hash
			for (var idx = 0, len = records.length; idx < len; idx++) {
				record_map[ record_ids[idx] ] = records[idx];
			}
			
			// distribute correct offset/limit set to each sub
			Object.keys(self.subs).forEach( function(key) {
				var sub = self.subs[key];
				var records = [];
				
				for (var idx = 0, len = Math.min(sub.limit, sort_pairs.length); idx < len; idx++) {
					var record_id = sort_pairs[idx + sub.offset][0];
					records.push( record_map[record_id] );
				}
				
				sub.emit('change', {
					records: records,
					total: sort_pairs.length
				});
			} ); // foreach sub
		} ); // getRecords
	},
	
	notifyVisible: function(record_idx) {
		// notify subs only if record_idx is within their offset/limit range
		// this is for existing record updates that didn't affect sort
		var self = this;
		if (!Tools.numKeys(this.subs)) return;
		
		var record_map = {};
		var sort_pairs = this.sort_pairs;
		var chosen_subs = [];
		
		for (var key in this.subs) {
			var sub = this.subs[key];
			if ((record_idx >= sub.offset) && (record_idx < sub.offset + sub.limit)) {
				chosen_subs.push( sub );
				for (var idx = 0, len = Math.min(sub.limit, sort_pairs.length); idx < len; idx++) {
					record_map[ sort_pairs[idx + sub.offset][0] ] = 1;
				}
			}
		}
		
		if (!chosen_subs.length) return;
		
		var record_ids = Object.keys(record_map);
		
		this.logDebug(8, "Loading " + record_ids.length + " records" );
		
		this.unbase.getRecords( this.index_key, record_ids, function(err, records) {
			if (err) {
				var err_msg = "Failed to fetch records: " + err;
				self.logError('storage', err_msg);
				return;
			}
			
			// copy loaded records back into hash
			for (var idx = 0, len = records.length; idx < len; idx++) {
				record_map[ record_ids[idx] ] = records[idx];
			}
			
			// distribute correct offset/limit set to each affected sub
			chosen_subs.forEach( function(sub) {
				var records = [];
				
				for (var idx = 0, len = Math.min(sub.limit, sort_pairs.length); idx < len; idx++) {
					var record_id = sort_pairs[idx + sub.offset][0];
					records.push( record_map[record_id] );
				}
				
				sub.emit('change', {
					records: records,
					total: sort_pairs.length
				});
			} ); // foreach sub
		} ); // getRecords
	},
	
	addSubscriber: function(sub) {
		// add subscriber to view
		this.logDebug(7, "Adding subscriber to view: " + sub.id);
		sub.view = this;
		this.subs[ sub.id ] = sub;
		
		// if initial search has already completed, fire off change event manually
		if (this.sort_pairs) sub.notifyChange();
	},
	
	removeSubscriber: function(sub) {
		// remove subscriber from view
		this.logDebug(7, "Removing subscriber from view: " + sub.id);
		delete this.subs[ sub.id ];
		
		// if last sub, kill view
		if (!Tools.numKeys(this.subs)) {
			this.logDebug(5, "All subscribers are gone, destroying view");
			this.destroy();
		}
	},
	
	broadcast: function(name, thingy) {
		// emit event to all subscribers
		for (var key in this.subs) {
			var sub = this.subs[key];
			sub.emit(name, thingy);
		}
	},
	
	destroy: function() {
		// destroy view, remove from parent
		this.logDebug(6, "Destroying view");
		this.broadcast('destroy');
		this.unbase.removeView(this);
	},
	
	debugLevel: function(level) {
		// check if we're logging at or above the requested level
		return (this.logger.get('debugLevel') >= level);
	},
	
	logDebug: function(level, msg, data) {
		// proxy request to system logger with correct component
		if (!data) data = {};
		data.id = this.search_id;
		data.index = this.index_key;
		this.logger.set( 'component', this.__name );
		this.logger.debug( level, msg, data );
	},
	
	logError: function(code, msg, data) {
		// proxy request to system logger with correct component
		if (!data) data = {};
		data.id = this.search_id;
		data.index = this.index_key;
		this.logger.set( 'component', this.__name );
		this.logger.error( code, msg, data );
	}
	
}); // class
