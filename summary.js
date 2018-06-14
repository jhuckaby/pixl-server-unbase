// PixlServer Unbase Summary View
// Copyright (c) 2018 Joseph Huckaby
// Released under the MIT License

var util = require("util");
var async = require('async');
var Class = require("pixl-class");
var Tools = require("pixl-tools");
var View = require("./view.js");

function noop() {};

module.exports = Class.create({
	
	__name: "UnbaseSummaryView",
	__parent: View,
	
	subs: null,
	values: null,
	
	search: function() {
		// perform initial search
		// in this case, just call notifyChange
		this.notifyChange();
	},
	
	update: function(state) {
		// update view after indexer insert/update
		// state: { action, idx_data, id, new_record, changed }
		var record_id = state.id;
		
		if (state.new_record || (state.action == 'delete')) {
			// new record or deleted record, summary has definitely changed
			this.notifyChange();
		}
		else {
			// record updated, let's see if our field changed
			if (state.changed && state.changed[this.field_id]) {
				this.notifyChange();
			}
		}
	},
	
	notifyChange: function() {
		// notify all subs that a summary change has taken place
		// only load summary once per view (all subs share it)
		var self = this;
		this.logDebug(8, "Refreshing field summary: " + this.field_id);
		
		this.storage.getFieldSummary( this.field_id, this.index, function(err, values) {
			if (err) {
				self.logError('summary', "Failed to load field summary: " + err);
				return;
			}
			
			self.values = values;
			
			self.logDebug(9, "Notifying all subscribers that a change has occurred");
			self.broadcast('change', {
				values: values
			});
		});
	},
	
	addSubscriber: function(sub) {
		// add subscriber to view
		this.logDebug(7, "Adding subscriber to summary view: " + sub.id);
		sub.view = this;
		this.subs[ sub.id ] = sub;
		
		// if initial search has already completed, fire off change event manually
		if (this.values) sub.emit('change', { values: this.values });
	}
	
}); // class
