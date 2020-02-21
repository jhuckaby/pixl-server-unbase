// PixlServer Unbase Component
// Copyright (c) 2018 Joseph Huckaby
// Released under the MIT License

var util = require("util");
var async = require('async');
var stringify = require('json-stable-stringify');
var Class = require("pixl-class");
var Tools = require("pixl-tools");
var Perf = require("pixl-perf");
var Component = require("pixl-server/component");

var View = require("./view.js");
var SummaryView = require("./summary.js");
var Subscriber = require("./subscriber.js");

function noop() {};

module.exports = Class.create({
	
	__name: 'Unbase',
	__parent: Component,
	__mixins: [],
	
	version: require('./package.json').version,
	
	defaultConfig: {
		base_path: 'unbase'
	},
	
	indexes: null,
	jobs: null,
	views: null,
	
	startup: function(callback) {
		// setup storage plugin
		var self = this;
		this.logDebug(2, "Setting up Unbase v" + this.version);
		
		// store local ref to storage system
		this.storage = this.server.Storage;
		if (!this.storage) return callback( new Error("Cannot locate pixl-server-storage component.") );
		
		// cache some config values, and listen for config refresh
		this.prepConfig();
		this.config.on('reload', this.prepConfig.bind(this) );
		
		// keep track of async jobs and views
		this.jobs = {};
		this.views = {};
		
		// allow config to bootstrap indexes
		this.indexes = this.config.get('indexes') || {};
		
		// but also load from storage hash
		this.storage.hashGetAll( this.basePath + '/indexes', function(err, items) {
			if (items) {
				Tools.mergeHashInto( self.indexes, items );
			}
			
			for (var index_key in self.indexes) {
				var index = self.indexes[index_key];
				self.logDebug(3, "Initializing index: " + index_key);
				index.base_path = self.basePath + '/index/' + index_key;
			}
			
			callback();
		});
	},
	
	prepConfig: function() {
		// save some config values
		this.basePath = this.config.get('base_path');
	},
	
	_uniqueIDCounter: 0,
	getUniqueID: function(prefix) {
		// generate unique id using high-res server time, and a static counter,
		// both converted to alphanumeric lower-case (base-36), ends up being ~10 chars.
		// allows for *up to* 1,296 unique ids per millisecond (sort of).
		this._uniqueIDCounter++;
		if (this._uniqueIDCounter >= Math.pow(36, 2)) this._uniqueIDCounter = 0;
		
		return [
			prefix,
			Tools.zeroPad( (new Date()).getTime().toString(36), 8 ),
			Tools.zeroPad( this._uniqueIDCounter.toString(36), 2 )
		].join('');		
	},
	
	createJob: function(args) {
		// create new background job
		var job = Tools.copyHash(args);
		job.id = this.getUniqueID('j');
		job.start = Tools.timeNow();
		job.progress = 0;
		job.title = job.title || ("(Untitled Job #" + job.id + ")");
		
		this.logDebug(6, "Starting job: " + job.title, job);
		
		this.jobs[ job.id ] = job;
		return job.id;
	},
	
	updateJob: function(id, args) {
		// update job, presumably progress
		var job = this.jobs[id];
		if (!job) {
			this.logError('job', "Job not found: " + id);
			return;
		}
		
		Tools.mergeHashInto(job, args);
	},
	
	finishJob: function(id) {
		// job is complete
		var job = this.jobs[id];
		if (!job) {
			this.logError('job', "Job not found: " + id);
			return;
		}
		
		job.elapsed = Tools.shortFloat( Tools.timeNow() - job.start );
		delete job.progress;
		
		this.logDebug(6, "Job completed: " + job.title, job);
		this.logTransaction('job_complete', job.title, job);
		
		delete this.jobs[id];
	},
	
	countIndexJobs: function(index_key) {
		// count number of active jobs for specific index
		var count = 0;
		
		for (var key in this.jobs) {
			var job = this.jobs[key];
			if (job.index == index_key) count++;
		}
		
		return count;
	},
	
	getAllRecordIDs: function(index_key, callback) {
		// get ALL record ids in memory (use array, not hash)
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		var ids = [];
		
		this.storage.hashEachPage( index.base_path + '/_id', function(items, callback) {
			// as of node v8, [].concat() is the fastest way of appending chunks to an array, 
			// beating out a for loop, splice.apply and push.apply
			ids = [].concat( ids, Object.keys(items) );
			callback();
		},
		function(err) {
			// ignore error (empty hash)
			callback( null, ids );
		} ); // hashEachPage
	},
	
	getIndex: function(index_key) {
		// get index by ID
		return this.this.indexes[index_key];
	},
	
	createIndex: function(index_key, index, callback) {
		// create new index
		if (!callback) callback = noop;
		var self = this;
		if (this.indexes[index_key]) return callback( new Error("Index already exists: " + index_key) );
		
		// some basic validation
		if (!index || !index.fields || !index.fields.length) {
			return callback( new Error("Invalid index configuration object.") );
		}
		if (Tools.findObject(index.fields, { _primary: 1 })) {
			return callback( new Error("Invalid index configuration key: _primary") );
		}
		
		for (var idx = 0, len = index.fields.length; idx < len; idx++) {
			var def = index.fields[idx];
			
			if (!def.id || !def.id.match(/^\w+$/)) {
				return callback( new Error("Invalid index field ID: " + def.id) );
			}
			if (def.id.match(/^(_id|_data|_sorters)$/)) {
				if (callback) callback( new Error("Invalid index field ID: " + def.id) );
				return;
			}
			
			if (def.type && !this.storage['prepIndex_' + def.type]) {
				return callback( new Error("Invalid index type: " + def.type) );
			}
			
			if (def.filter && !this.storage['filterWords_' + def.filter]) {
				return callback( new Error("Invalid index filter: " + def.filter) );
			}
		} // foreach def
		
		// take over base_path
		index.base_path = this.basePath + '/index/' + index_key;
		
		this.logDebug(3, "Creating new index: " + index_key, index);
		
		this.indexes[index_key] = index;
		this.storage.hashPut( this.basePath + '/indexes', index_key, index, callback );
	},
	
	updateIndex: function(index_key, updates, callback) {
		// update existing index
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		if (this.countIndexJobs(index_key)) return callback( new Error("Index is busy: " + index_key) );
		
		// some basic validation
		if (updates.fields || updates.sorters) {
			return callback( new Error("Invalid index update object: Cannot update fields or sorters using updateIndex.") );
		}
		if (updates.base_path) delete updates.base_path;
		
		this.logDebug(3, "Updating index: " + index_key, updates);
		
		for (var key in updates) {
			index[key] = updates[key];
		}
		
		if (updates.remove_words && this.storage.removeWordCache) {
			delete this.storage.removeWordCache[ index.base_path ];
		}
		
		this.storage.hashPut( this.basePath + '/indexes', index_key, index, callback );
	},
	
	deleteIndex: function(index_key, callback) {
		// delete index and all record data
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		if (this.countIndexJobs(index_key)) return callback( new Error("Index is busy: " + index_key) );
		
		// abort all index's active views here
		if (this.views[index_key]) {
			for (var search_id in this.views[index_key]) {
				var view = this.views[index_key][search_id];
				view.destroy();
			}
		}
		
		var job = this.createJob({ title: "Deleting index: " + index_key, index: index_key });
		var num_records = 0;
		var record_idx = 0;
		var all_record_ids = [];
		
		async.series(
			[
				function(callback) {
					// get all record ids
					// we need to do this because hashEachPage share-locks the hash
					// so we can't delete & iterate simultaneously
					self.getAllRecordIDs( index_key, function(err, ids) {
						// ignore error (will just be empty list)
						all_record_ids = ids;
						num_records = ids.length;
						callback();
					} );
				},
				function(callback) {
					// remove all records
					async.eachSeries( all_record_ids,
						function(record_id, callback) {
							self.delete( index_key, record_id, function(err) {
								if (err) return callback(err);
								
								// update job progress
								record_idx++;
								self.updateJob(job, { progress: record_idx / num_records });
								
								callback();
							} );
						},
						callback
					); // eachSeries
				},
				function(callback) {
					// finally, delete index
					delete self.indexes[index_key];
					self.storage.hashDelete( self.basePath + '/indexes', index_key, callback );
				}
			],
			function(err) {
				// job finished
				self.finishJob(job);
				callback(err);
			}
		); // series
	},
	
	reindex: function(index_key, field_ids, callback) {
		// reindex all records
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		if (this.countIndexJobs(index_key)) return callback( new Error("Index is busy: " + index_key) );
		
		// default to all fields
		if (!field_ids) {
			field_ids = index.fields.map( function(field) { return field.id; } );
		}
		if (!field_ids.length) return callback( new Error("No field IDs passed to reindex.") );
		
		for (var idx = 0, len = field_ids.length; idx < len; idx++) {
			var field_id = field_ids[idx];
			var field = Tools.findObject( index.fields, { id: field_id } );
			if (!field) return callback( new Error("Field not found: " + field_id) );
		}
		
		var job = this.createJob({ title: "Reindexing: " + index_key, index: index_key });
		var num_records = 0;
		var record_idx = 0;
		var all_record_ids = [];
		
		async.series(
			[
				function(callback) {
					// get all record ids
					self.getAllRecordIDs( index_key, function(err, ids) {
						// ignore error (will just be empty list)
						all_record_ids = ids;
						num_records = ids.length;
						callback();
					} );
				},
				function(callback) {
					// trigger a field delete on the old field
					for (var idx = 0, len = field_ids.length; idx < len; idx++) {
						var field_id = field_ids[idx];
						var field = Tools.findObject( index.fields, { id: field_id } );
						field.delete = true;
					}
					
					// update all records (part 1/2)
					async.eachSeries( all_record_ids,
						function(record_id, callback) {
							self.getRecord( index_key, record_id, function(err, record_data) {
								self.storage.indexRecord( record_id, record_data, index, function(err, state) {
									if (err) return callback(err);
									
									// update job progress (part 1/2)
									record_idx++;
									self.updateJob(job, { progress: 0.0 + ((record_idx / num_records) * 0.5) });
									
									callback();
								} ); // indexRecord
							} ); // getRecord
						},
						callback
					); // eachSeries
				},
				function(callback) {
					// remove delete flags
					for (var idx = 0, len = field_ids.length; idx < len; idx++) {
						var field_id = field_ids[idx];
						var field = Tools.findObject( index.fields, { id: field_id } );
						delete field.delete;
					}
					
					// update all records (part 2/2)
					async.eachSeries( all_record_ids,
						function(record_id, callback) {
							self.getRecord( index_key, record_id, function(err, record_data) {
								self.storage.indexRecord( record_id, record_data, index, function(err, state) {
									if (err) return callback(err);
									
									// update job progress (part 2/2)
									record_idx++;
									self.updateJob(job, { progress: 0.5 + ((record_idx / num_records) * 0.5) });
									
									callback();
								} ); // indexRecord
							} ); // getRecord
						},
						callback
					); // eachSeries
				}
			],
			function(err) {
				// job finished
				self.finishJob(job);
				callback(err);
			}
		); // series
	},
	
	addField: function(index_key, field, callback) {
		// add new field to index, and reindex records
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		if (this.countIndexJobs(index_key)) return callback( new Error("Index is busy: " + index_key) );
		
		// some basic validation
		if (!field.id || (typeof(field.id) != 'string')) {
			return callback( new Error("Invalid or missing Field ID") );
		}
		if (field.id.match(/^(_id|_data|_sorters)$/)) {
			return callback( new Error("Invalid Field ID: " + field.id) );
		}
		if (Tools.findObject(index.fields, { id: field.id })) {
			return callback( new Error("Field already exists in index: " + field.id) );
		}
		
		var job = this.createJob({ title: "Adding new field: " + field.id, index: index_key });
		var num_records = 0;
		var record_idx = 0;
		var all_record_ids = [];
		
		async.series(
			[
				function(callback) {
					// first, update index
					index.fields.push( field );
					self.storage.hashPut( self.basePath + '/indexes', index_key, index, callback );
				},
				function(callback) {
					// get all record ids
					self.getAllRecordIDs( index_key, function(err, ids) {
						// ignore error (will just be empty list)
						all_record_ids = ids;
						num_records = ids.length;
						callback();
					} );
				},
				function(callback) {
					// update all records
					async.eachSeries( all_record_ids,
						function(record_id, callback) {
							self.getRecord( index_key, record_id, function(err, record_data) {
								self.storage.indexRecord( record_id, record_data, index, function(err, state) {
									if (err) return callback(err);
									
									// update job progress
									record_idx++;
									self.updateJob(job, { progress: record_idx / num_records });
									
									callback();
								} ); // indexRecord
							} ); // getRecord
						},
						callback
					); // eachSeries
				}
			],
			function(err) {
				// job finished
				self.finishJob(job);
				callback(err);
			}
		); // series
	},
	
	updateField: function(index_key, new_field, callback) {
		// update field in index, and reindex records
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		if (this.countIndexJobs(index_key)) return callback( new Error("Index is busy: " + index_key) );
		
		var field_id = new_field.id;
		var old_field = Tools.findObject( index.fields, { id: field_id } );
		if (!old_field) return callback( new Error("Field not found: " + field_id) );
		
		var job = this.createJob({ title: "Updating field: " + field_id, index: index_key });
		var num_records = 0;
		var record_idx = 0;
		var all_record_ids = [];
		
		async.series(
			[
				function(callback) {
					// get all record ids
					self.getAllRecordIDs( index_key, function(err, ids) {
						// ignore error (will just be empty list)
						all_record_ids = ids;
						num_records = ids.length;
						callback();
					} );
				},
				function(callback) {
					// trigger a field delete on the old field
					old_field.delete = true;
					
					// update all records (part 1/2)
					async.eachSeries( all_record_ids,
						function(record_id, callback) {
							self.getRecord( index_key, record_id, function(err, record_data) {
								self.storage.indexRecord( record_id, record_data, index, function(err, state) {
									if (err) return callback(err);
									
									// update job progress (part 1/2)
									record_idx++;
									self.updateJob(job, { progress: 0.0 + ((record_idx / num_records) * 0.5) });
									
									callback();
								} ); // indexRecord
							} ); // getRecord
						},
						callback
					); // eachSeries
				},
				function(callback) {
					// update field and save index
					var idx = Tools.findObjectIdx( index.fields, { id: field_id } );
					index.fields[idx] = new_field;
					self.storage.hashPut( self.basePath + '/indexes', index_key, index, callback );
				},
				function(callback) {
					// update all records (part 2/2)
					async.eachSeries( all_record_ids,
						function(record_id, callback) {
							self.getRecord( index_key, record_id, function(err, record_data) {
								self.storage.indexRecord( record_id, record_data, index, function(err, state) {
									if (err) return callback(err);
									
									// update job progress (part 2/2)
									record_idx++;
									self.updateJob(job, { progress: 0.5 + ((record_idx / num_records) * 0.5) });
									
									callback();
								} ); // indexRecord
							} ); // getRecord
						},
						callback
					); // eachSeries
				}
			],
			function(err) {
				// job finished
				self.finishJob(job);
				callback(err);
			}
		); // series
	},
	
	deleteField: function(index_key, field_id, callback) {
		// delete field from index, and reindex records
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		if (this.countIndexJobs(index_key)) return callback( new Error("Index is busy: " + index_key) );
		
		var field = Tools.findObject( index.fields, { id: field_id } );
		if (!field) return callback( new Error("Field not found: " + field_id) );
		
		var job = this.createJob({ title: "Deleting field: " + field.id, index: index_key });
		var num_records = 0;
		var record_idx = 0;
		var all_record_ids = [];
		
		// trigger a field delete for the indexer
		field.delete = true;
		
		async.series(
			[
				function(callback) {
					// get all record ids
					self.getAllRecordIDs( index_key, function(err, ids) {
						// ignore error (will just be empty list)
						all_record_ids = ids;
						num_records = ids.length;
						callback();
					} );
				},
				function(callback) {
					// update all records
					async.eachSeries( all_record_ids,
						function(record_id, callback) {
							self.getRecord( index_key, record_id, function(err, record_data) {
								self.storage.indexRecord( record_id, record_data, index, function(err, state) {
									if (err) return callback(err);
									
									// update job progress
									record_idx++;
									self.updateJob(job, { progress: record_idx / num_records });
									
									callback();
								} ); // indexRecord
							} ); // getRecord
						},
						callback
					); // eachSeries
				},
				function(callback) {
					// finally, update index
					Tools.deleteObject( index.fields, { id: field_id } );
					self.storage.hashPut( self.basePath + '/indexes', index_key, index, callback );
				},
			],
			function(err) {
				// job finished
				self.finishJob(job);
				callback(err);
			}
		); // series
	},
	
	addSorter: function(index_key, sorter, callback) {
		// add new sorter to index, and reindex records
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		if (this.countIndexJobs(index_key)) return callback( new Error("Index is busy: " + index_key) );
		
		if (!index.sorters) index.sorters = [];
		
		// some basic validation
		if (!sorter.id || (typeof(sorter.id) != 'string')) {
			return callback( new Error("Invalid or missing Sorter ID") );
		}
		if (sorter.id.match(/^(_id|_data)$/)) {
			return callback( new Error("Invalid Sorter ID: " + sorter.id) );
		}
		if (Tools.findObject(index.sorters, { id: sorter.id })) {
			return callback( new Error("Sorter already exists in index: " + sorter.id) );
		}
		
		var job = this.createJob({ title: "Adding new sorter: " + sorter.id, index: index_key });
		var num_records = 0;
		var record_idx = 0;
		var all_record_ids = [];
		
		async.series(
			[
				function(callback) {
					// first, update index
					index.sorters.push( sorter );
					self.storage.hashPut( self.basePath + '/indexes', index_key, index, callback );
				},
				function(callback) {
					// get all record ids
					self.getAllRecordIDs( index_key, function(err, ids) {
						// ignore error (will just be empty list)
						all_record_ids = ids;
						num_records = ids.length;
						callback();
					} );
				},
				function(callback) {
					// update all records
					async.eachSeries( all_record_ids,
						function(record_id, callback) {
							self.getRecord( index_key, record_id, function(err, record_data) {
								self.storage.indexRecord( record_id, record_data, index, function(err, state) {
									if (err) return callback(err);
									
									// update job progress
									record_idx++;
									self.updateJob(job, { progress: record_idx / num_records });
									
									callback();
								} ); // indexRecord
							} ); // getRecord
						},
						callback
					); // eachSeries
				}
			],
			function(err) {
				// job finished
				self.finishJob(job);
				callback(err);
			}
		); // series
	},
	
	updateSorter: function(index_key, new_sorter, callback) {
		// update sorter for index, and reindex records
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		if (this.countIndexJobs(index_key)) return callback( new Error("Index is busy: " + index_key) );
		
		if (!index.sorters) index.sorters = [];
		
		// some basic validation
		if (!new_sorter.id || (typeof(new_sorter.id) != 'string')) {
			return callback( new Error("Invalid or missing Sorter ID") );
		}
		if (!Tools.findObject(index.sorters, { id: new_sorter.id })) {
			return callback( new Error("Sorter not found: " + new_sorter.id) );
		}
		
		var job = this.createJob({ title: "Updating sorter: " + new_sorter.id, index: index_key });
		var num_records = 0;
		var record_idx = 0;
		var all_record_ids = [];
		
		async.series(
			[
				function(callback) {
					// first, update index
					var idx = Tools.findObjectIdx( index.sorters, { id: new_sorter.id } );
					index.sorters[idx] = new_sorter;
					self.storage.hashPut( self.basePath + '/indexes', index_key, index, callback );
				},
				function(callback) {
					// get all record ids
					self.getAllRecordIDs( index_key, function(err, ids) {
						// ignore error (will just be empty list)
						all_record_ids = ids;
						num_records = ids.length;
						callback();
					} );
				},
				function(callback) {
					// update all records
					async.eachSeries( all_record_ids,
						function(record_id, callback) {
							self.getRecord( index_key, record_id, function(err, record_data) {
								self.storage.indexRecord( record_id, record_data, index, function(err, state) {
									if (err) return callback(err);
									
									// update job progress
									record_idx++;
									self.updateJob(job, { progress: record_idx / num_records });
									
									callback();
								} ); // indexRecord
							} ); // getRecord
						},
						callback
					); // eachSeries
				}
			],
			function(err) {
				// job finished
				self.finishJob(job);
				callback(err);
			}
		); // series
	},
	
	deleteSorter: function(index_key, sorter_id, callback) {
		// delete sorter from index, and reindex records
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		if (this.countIndexJobs(index_key)) return callback( new Error("Index is busy: " + index_key) );
		
		if (!index.sorters) index.sorters = [];
		
		var sorter = Tools.findObject( index.sorters, { id: sorter_id } );
		if (!sorter) return callback( new Error("Sorter not found: " + field_id) );
		
		var job = this.createJob({ title: "Deleting sorter: " + sorter.id, index: index_key });
		var num_records = 0;
		var record_idx = 0;
		var all_record_ids = [];
		
		// trigger a sorter delete for the indexer
		sorter.delete = true;
		
		async.series(
			[
				function(callback) {
					// get all record ids
					self.getAllRecordIDs( index_key, function(err, ids) {
						// ignore error (will just be empty list)
						all_record_ids = ids;
						num_records = ids.length;
						callback();
					} );
				},
				function(callback) {
					// update all records
					async.eachSeries( all_record_ids,
						function(record_id, callback) {
							self.getRecord( index_key, record_id, function(err, record_data) {
								self.storage.indexRecord( record_id, record_data, index, function(err, state) {
									if (err) return callback(err);
									
									// update job progress
									record_idx++;
									self.updateJob(job, { progress: record_idx / num_records });
									
									callback();
								} ); // indexRecord
							} ); // getRecord
						},
						callback
					); // eachSeries
				},
				function(callback) {
					// finally, update index
					Tools.deleteObject( index.sorters, { id: sorter_id } );
					self.storage.hashPut( self.basePath + '/indexes', index_key, index, callback );
				},
			],
			function(err) {
				// job finished
				self.finishJob(job);
				callback(err);
			}
		); // series
	},
	
	bulkInsert: function(index_key, records, callback) {
		// bulk insert array of records
		// array elements must have: { id, data }
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		if (this.countIndexJobs(index_key)) return callback( new Error("Index is busy: " + index_key) );
		
		// some basic validation
		if ((typeof(records) != 'object') || !records.length) {
			return callback( new Error("Bulk Insert: Invalid records array") );
		}
		for (var idx = 0, len = records.length; idx < len; idx++) {
			var record = records[idx];
			if (!record.id || !record.data || (typeof(record.data) != 'object')) {
				return callback( new Error("Bulk Insert: Record #" + idx + " is malformed") );
			}
		}
		
		var job = this.createJob({ title: "Inserting " + records.length + " records", index: index_key });
		var num_records = records.length;
		var record_idx = 0;
		
		async.eachSeries( records,
			function(record, callback) {
				self.insert( index_key, record.id, record.data, function(err) {
					if (err) {
						return callback( new Error("Bulk Insert: Record #" + record_idx + " failed: " + err) );
					}
					
					// update job progress
					record_idx++;
					self.updateJob(job, { progress: record_idx / num_records });
					
					callback();
				} ); // insert
			},
			function(err) {
				// job finished
				self.finishJob(job);
				callback(err);
			}
		); // eachSeries
		
		return job;
	},
	
	bulkUpdate: function(index_key, records, updates, callback) {
		// bulk update array of records with same updates
		// array elements must have { id }, or just plain id strings
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		if (this.countIndexJobs(index_key)) return callback( new Error("Index is busy: " + index_key) );
		
		// some basic validation
		if ((typeof(records) != 'object') || !records.length) {
			return callback( new Error("Bulk Update: Invalid records array") );
		}
		for (var idx = 0, len = records.length; idx < len; idx++) {
			if (typeof(records[idx]) != 'object') records[idx] = { id: records[idx] };
			var record = records[idx];
			if (!record.id) {
				return callback( new Error("Bulk Update: Record #" + idx + " has no ID") );
			}
		}
		
		var job = this.createJob({ title: "Updating " + records.length + " records", index: index_key });
		var num_records = records.length;
		var record_idx = 0;
		
		async.eachSeries( records,
			function(record, callback) {
				self.update( index_key, record.id, updates, function(err) {
					if (err) {
						return callback( new Error("Bulk Update: Record #" + record_idx + " failed: " + err) );
					}
					
					// update job progress
					record_idx++;
					self.updateJob(job, { progress: record_idx / num_records });
					
					callback();
				} ); // insert
			},
			function(err) {
				// job finished
				self.finishJob(job);
				callback(err);
			}
		); // eachSeries
		
		return job;
	},
	
	bulkDelete: function(index_key, records, callback) {
		// bulk delete array of records
		// array elements must have { id }, or just plain id strings
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		if (this.countIndexJobs(index_key)) return callback( new Error("Index is busy: " + index_key) );
		
		// some basic validation
		if ((typeof(records) != 'object') || !records.length) {
			return callback( new Error("Bulk Delete: Invalid records array") );
		}
		for (var idx = 0, len = records.length; idx < len; idx++) {
			if (typeof(records[idx]) != 'object') records[idx] = { id: records[idx] };
			var record = records[idx];
			if (!record.id) {
				return callback( new Error("Bulk Delete: Record #" + idx + " has no ID") );
			}
		}
		
		var job = this.createJob({ title: "Deleting " + records.length + " records", index: index_key });
		var num_records = records.length;
		var record_idx = 0;
		
		async.eachSeries( records,
			function(record, callback) {
				self.delete( index_key, record.id, function(err) {
					if (err) {
						return callback( new Error("Bulk Delete: Record #" + record_idx + " failed: " + err) );
					}
					
					// update job progress
					record_idx++;
					self.updateJob(job, { progress: record_idx / num_records });
					
					callback();
				} ); // insert
			},
			function(err) {
				// job finished
				self.finishJob(job);
				callback(err);
			}
		); // eachSeries
		
		return job;
	},
	
	insert: function(index_key, record_id, record_data, callback) {
		// insert (or update) full record
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		var data_path = this.basePath + '/records/' + index_key + '/' + record_id;
		
		this.logDebug(6, "Inserting/updating record: " + index_key + '/' + record_id, this.debugLevel(10) ? record_data : null);
		
		// lock record
		this.storage.lock( data_path, true, function() {
			
			// store data itself
			self.storage.put( data_path, record_data, function(err) {
				if (err) {
					self.storage.unlock( data_path );
					return callback(err);
				}
				
				// now index it
				self.storage.indexRecord( record_id, record_data, index, function(err, state) {
					if (err) {
						self.storage.unlock( data_path );
						return callback(err);
					}
					
					// update view triggers
					state.action = 'insert';
					self.updateViews(index_key, state);
					
					self.storage.unlock( data_path );
					callback();
				}); // indexRecord
			}); // put
		}); // lock
	},
	
	update: function(index_key, record_id, updates, callback) {
		// update existing record, allowing for sparse and num increments
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		var data_path = this.basePath + '/records/' + index_key + '/' + record_id;
		
		this.logDebug(6, "Updating record: " + index_key + '/' + record_id, this.debugLevel(10) ? updates : null);
		
		// lock record
		this.storage.lock( data_path, true, function() {
			
			// fetch existing record
			self.storage.get( data_path, function(err, record_data) {
				if (err) {
					self.storage.unlock( data_path );
					return callback(err);
				}
				
				// apply updates
				for (var ukey in updates) {
					var uvalue = updates[ukey];
					if ((typeof(uvalue) == 'string') && (typeof(record_data[ukey]) == 'number') && uvalue.match(/^(\+|\-)([\d\.]+)$/)) {
						// increment / decrement numbers
						var op = RegExp.$1;
						var amt = parseFloat(RegExp.$2);
						if (op == '+') record_data[ukey] += amt;
						else record_data[ukey] -= amt;
					}
					else if ((typeof(uvalue) == 'string') && uvalue.match(/^(\+|\-)\w+/)) {
						// add/remove CSV tags
						var values = {};
						if (record_data[ukey]) {
							record_data[ukey].split(/\W+/).forEach( function(tag) { values[tag] = 1; } );
						}
						uvalue.replace(/(\+|\-)(\w+)/g, function(m_all, op, tag) {
							if (op == '+') values[tag] = 1;
							else delete values[tag];
							return '';
						});
						record_data[ukey] = Object.keys(values).join(', ');
					}
					else record_data[ukey] = uvalue;
				}
				
				// store data itself
				self.storage.put( data_path, record_data, function(err) {
					if (err) {
						self.storage.unlock( data_path );
						return callback(err);
					}
					
					// now index it
					self.storage.indexRecord( record_id, record_data, index, function(err, state) {
						if (err) {
							self.storage.unlock( data_path );
							return callback(err);
						}
						
						// update view triggers
						state.action = 'insert';
						self.updateViews(index_key, state);
						
						self.storage.unlock( data_path );
						callback();
					}); // indexRecord
				}); // put
			}); // get
		}); // lock
	},
	
	delete: function(index_key, record_id, callback) {
		// delete record and index data
		if (!callback) callback = noop;
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		var data_path = this.basePath + '/records/' + index_key + '/' + record_id;
		
		this.logDebug(6, "Deleting record: " + index_key + '/' + record_id);
		
		// lock record
		this.storage.lock( data_path, true, function() {
			
			// unindex
			self.storage.unindexRecord( record_id, index, function(err, state) {
				if (err) {
					self.storage.unlock( data_path );
					return callback(err);
				}
				
				// finally, delete record data
				self.storage.delete( data_path, function(err) {
					if (err) {
						self.storage.unlock( data_path );
						return callback(err);
					}
					
					// update view triggers
					state.action = 'delete';
					self.updateViews(index_key, state);
					
					self.storage.unlock( data_path );
					callback();
				} ); // delete
			} ); // unindexRecord
		}); // lock
	},
	
	get: function(index_key, thingy, callback) {
		// get single or multiple records
		if (typeof(thingy) == 'object') this.getRecords(index_key, thingy, callback);
		else this.getRecord(index_key, thingy, callback);
	},
	
	getRecord: function(index_key, record_id, callback) {
		// get single record
		var data_path = this.basePath + '/records/' + index_key + '/' + record_id;
		this.storage.get( data_path, callback );
	},
	
	getRecords: function(index_key, record_ids, callback) {
		// get multiple records at once
		var self = this;
		
		var data_paths = record_ids.map( function(record_id) {
			return self.basePath + '/records/' + index_key + '/' + record_id;
		} );
		
		this.storage.getMulti( data_paths, callback );
	},
	
	search: function(index_key, query, opts, callback) {
		// perform combo search, sort, paginate and fetch
		// opts: { sort_by, sort_dir, [sort_type], offset, limit }
		var self = this;
		var index = this.indexes[index_key];
		if (!index) return callback( new Error("Index not found: " + index_key) );
		
		this.logDebug(7, "Performing " + index_key + " search: " + query, opts);
		
		// shortcut query for summary: #summary:status
		if ((typeof(query) == 'string') && query.match(/^\s*\#summary\:(\w+)/i)) {
			var field_id = RegExp.$1;
			return this.storage.getFieldSummary( field_id, index, function(err, values) {
				callback(err, err ? null : {
					values: values
				});
			});
		} // field summary
		
		if (!opts.sort_by) opts.sort_by = '_id';
		if (!opts.sort_dir) opts.sort_dir = 1;
		
		this.storage.searchRecords( query, index, function(err, results) {
			if (err) return callback(err);
			
			var finish = function(err, sorted_ids) {
				if (err) return callback(err);
				var total = sorted_ids.length;
				// if (!total) return callback(null, { records: [], total: 0 } );
				
				// paginate
				if (opts.limit) {
					sorted_ids = sorted_ids.splice( opts.offset || 0, opts.limit );
					self.logDebug( 8, 
						"Found " + total + " records, returning " + sorted_ids.length + " at offset " + (opts.offset || 0), 
						(opts.limit <= 100) ? sorted_ids : null
					);
				}
				else {
					self.logDebug( 8, 
						"Found " + total + " records, returning all of them", 
						(total <= 100) ? sorted_ids : null
					);
				}
				
				// load records fast
				self.getRecords( index_key, sorted_ids, function(err, records) {
					if (err) return callback(err);
					callback( null, { records: records, total: total } );
				} );
				
			}; // finish
			
			if (opts.sort_by == '_id') {
				// natural ID sort (fast)
				var comparator = (opts.sort_type == 'number') ?
					function(a, b) { return (parseFloat(a) - parseFloat(b)) * opts.sort_dir; } :
					function(a, b) { return a.toString().localeCompare(b) * opts.sort_dir; };
				
				var sorted_ids = Object.keys(results).sort( comparator );
				finish( null, sorted_ids );
			}
			else {
				// sorter sort (slow)
				self.storage.sortRecords( results, opts.sort_by, opts.sort_dir, index, finish );
			}
			
		} ); // searchRecords
	},
	
	parseSearchQuery: function(index_key, query) {
		// parse search query, return native object and signature (id)
		// synchronous function - will throw
		var index = this.indexes[index_key];
		if (!index) throw new Error("Index not found: " + index_key);
		
		if (typeof(query) == 'string') {
			query = query.trim();
			
			if (query == '*') {
				// fetch all records
				return {
					query: query,
					id: Tools.digestHex(query, 'md5')
				};
			}
			else if (query.match(/^\([\s\S]+\)$/)) {
				// PxQL syntax, parse grammar
				query = this.storage.parseGrammar(query, index);
				if (query.err) throw query.err;
			}
			else {
				// simple query syntax
				query = this.storage.parseSearchQuery(query, index);
			}
		}
		
		if (!query.criteria || !query.criteria.length) {
			throw new Error("Invalid search query");
		}
		
		return {
			query: query,
			id: Tools.digestHex( stringify(query, 'md5') )
		};
	},
	
	createView: function(opts) {
		// create new view
		var view = new View(opts);
		view.init( this.server );
		return view;
	},
	
	createSummaryView: function(opts) {
		// create new summary field view
		var view = new SummaryView(opts);
		view.init( this.server );
		return view;
	},
	
	createSubscriber: function(opts) {
		// create new subscriber
		var sub = new Subscriber(opts);
		sub.id = this.getUniqueID('s');
		sub.init( this.server );
		return sub;
	},
	
	subscribe: function(index_key, query, opts) {
		// subscribe to a live search
		// synchronous function - will throw
		// opts: { sort_by, sort_dir, [sort_type], offset, limit }
		var index = this.indexes[index_key];
		if (!index) throw new Error("Index not found: " + index_key);
		
		// shortcut query for summary: #summary:status
		if ((typeof(query) == 'string') && query.match(/^\s*\#summary\:(\w+)/i)) {
			var field_id = RegExp.$1;
			return this.subscribeSummary(index_key, field_id);
		}
		
		if (!opts.sort_by) opts.sort_by = '_id';
		if (!opts.sort_dir) opts.sort_dir = 1;
		if (!opts.offset) opts.offset = 0;
		if (!opts.limit) opts.limit = 1;
		
		// merge id, query and index_key into opts
		var args = this.parseSearchQuery(index_key, query);
		
		opts.search_id = Tools.digestHex( args.id + '|' + opts.sort_by + '|' + opts.sort_dir, 'md5' );
		opts.query = args.query;
		opts.index_key = index_key;
		opts.index = index;
		opts.orig_query = query; // for logging
		
		// start new view?
		if (!this.views[index_key]) {
			this.views[index_key] = {};
		}
		if (!this.views[index_key][opts.search_id]) {
			this.views[index_key][opts.search_id] = this.createView( opts );
		}
		var view = this.views[index_key][opts.search_id];
		
		// create subscriber
		var sub = this.createSubscriber(opts);
		
		// join view
		view.addSubscriber( sub );
		
		// return sub ref for caller
		return sub;
	},
	
	subscribeSummary: function(index_key, field_id) {
		// subscribe to live field summary
		// synchronous function - will throw
		var index = this.indexes[index_key];
		if (!index) throw new Error("Index not found: " + index_key);
		
		var opts = {
			search_id: Tools.digestHex( '#summary:' + field_id, 'md5' ),
			field_id: field_id,
			index_key: index_key,
			index: index,
			orig_query: '#summary:' + field_id // for logging
		};
		
		// start new view or sub to existing
		if (!this.views[index_key]) {
			this.views[index_key] = {};
		}
		if (!this.views[index_key][opts.search_id]) {
			this.views[index_key][opts.search_id] = this.createSummaryView( opts );
		}
		var view = this.views[index_key][opts.search_id];
		
		// create subscriber
		var sub = this.createSubscriber(opts);
		
		// join view
		view.addSubscriber( sub );
		
		// return sub ref for caller
		return sub;
	},
	
	removeView: function(view) {
		// deregister view from management
		var search_id = view.search_id;
		var index_key = view.index_key;
		
		if (this.views[index_key] && this.views[index_key][search_id]) {
			delete this.views[index_key][search_id];
		}
	},
	
	updateViews: function(index_key, state) {
		// update all applicable views after record change
		// enqueue this for background processing
		var self = this;
		
		if (this.views[index_key] && Tools.numKeys(this.views[index_key])) {
			this.storage.enqueue({
				action: 'custom', 
				label: 'unbaseUpdateViews',
				handler: function(task, callback) {
					for (var key in self.views[index_key]) {
						var view = self.views[index_key][key];
						view.update(state);
					}
					callback();
				}
			});
		}
	},
	
	getStats: function() {
		// get perf and other misc stats
		var stats = this.storage.getStats();
		stats.jobs = this.jobs;
		return stats;
	},
	
	waitForAllJobs: function(callback) {
		// wait for all jobs to finish before proceeding
		var self = this;
		var num_jobs = Tools.numKeys(this.jobs);
		
		if (num_jobs) {
			this.logDebug(3, "Waiting for " + num_jobs + " jobs to finish", Object.keys(this.jobs));
			
			async.whilst(
				function () {
					return (Tools.numKeys(self.jobs) > 0);
				},
				function (callback) {
					setTimeout( function() { callback(); }, 250 );
				},
				function() {
					// all jobs finished
					callback();
				}
			); // whilst
		}
		else callback();
	},
	
	shutdown: function(callback) {
		// shutdown storage
		var self = this;
		this.logDebug(2, "Shutting down Unbase");
		
		// destroy all views
		for (var index_key in this.views) {
			for (var search_id in this.views[index_key]) {
				var view = this.views[index_key][search_id];
				view.destroy();
			}
		}
		
		this.waitForAllJobs( function() {
			callback();
		} );
	}
	
}); // class
