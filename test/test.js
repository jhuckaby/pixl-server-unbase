// Unit tests for Unbase Component
// Copyright (c) 2018 Joseph Huckaby
// Released under the MIT License

var os = require('os');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var async = require('async');

var Class = require("pixl-class");
var PixlServer = require('pixl-server');
var Tools = require('pixl-tools');

process.chdir( __dirname );

var base_data_dir = path.join( os.tmpdir(), 'unbase-unit-test-data' );

var server = new PixlServer({
	
	__name: 'UnitServer',
	__version: "1.0",
	
	configFile: "config.json",
	
	components: [
		require("pixl-server-storage"),
		require("../main.js")
	]
	
});

var sample_data = require('./sample-data.json');
var sample_tickets = sample_data.Ticket;

// Unit Tests

module.exports = {
	setUp: function (callback) {
		var self = this;
		this.server = server;
		
		// hook server prestart to massage config to our liking
		server.on('prestart', function() {
			var storage_config = server.Storage.config.get();
			
			// optionally swap out engine on CLI
			if (self.args.engine) storage_config.engine = self.args.engine;
			
			// override Filesystem base dir to go somewhere more sane
			if (storage_config.Filesystem) storage_config.Filesystem.base_dir = base_data_dir;
		});
		
		// delete old unit test log
		cp.exec("rm -rf test.log " + base_data_dir, function(err, stdout, stderr) {
			// startup mock server
			server.startup( function() {
				// startup complete
				
				// write log in sync mode, for troubleshooting
				server.logger.set('sync', true);
				
				// save ref to storage
				self.storage = server.Storage;
				self.unbase = server.Unbase;
				
				// startup complete
				// delay this by 1ms so the log is in the correct order (pre-start is async)
				setTimeout( function() { callback(); }, 1 );
			} ); // startup
		} ); // delete
	},
	
	beforeEach: function(test) {
		this.unbase.logDebug(9, "BEGIN UNIT TEST: " + test.name);
	},
	
	afterEach: function(test) {
		this.unbase.logDebug(9, "END UNIT TEST: " + test.name);
	},
	
	onAssertFailure: function(test, msg, data) {
		this.unbase.logDebug(9, "UNIT ASSERT FAILURE: " + test.file + ": " + test.name + ": " + msg, data);
	},
	
	tests: [
		
		function testCreateIndex(test) {
			var index = {
				fields: [
					{
						id: "status",
						source: "/Status"
						// Note: master_list missing (added later in unit test)
					},
					{
						id: "title",
						source: "/Summary",
						min_word_length: 3,
						max_word_length: 128,
						use_remove_words: 1
					},
					{
						id: "modified",
						source: "/Modifydate",
						type: "date"
					}
				],
				
				remove_words: ["the","of","and","a","to","in","is","you","that","it","he","was","for","on","are","as","with","his","they","I","at","be","this","have","from","or","one","had","by","word","but","not","what","all","were","we","when","your","can","said","there","use","an","each","which","she","do","how","their","if","will","up","other","about","out","many","then","them","these","so","some","her","would","make","like","him","into","time","has","look","two","more","write","go","see","number","no","way","could","people","my","than","first","water","been","call","who","oil","its","now","find","long","down","day","did","get","come","made","may","part"]
			};
			
			this.unbase.createIndex( "myapp", index, function(err) {
				test.ok( !err, "No error creating index: " + err );
				test.done();
			} );
		},
		
		function testInsertRecord(test) {
			var record = sample_tickets[0];
			this.unbase.insert( "myapp", record.ID, record, function(err) {
				test.ok( !err, "No error inserting record: " + err );
				test.done();
			} );
		},
		
		function testGetRecord(test) {
			var orig_record = sample_tickets[0];
			this.unbase.get( "myapp", orig_record.ID, function(err, record) {
				test.ok( !err, "No error inserting record: " + err );
				test.ok( !!record, "Got record in response" );
				test.ok( record.ID === orig_record.ID, "Record ID is correct: " + record.ID );
				test.ok( record.Status === "Open", "Record Status is correct: " + record.Status );
				test.done();
			} );
		},
		
		function testSearchRecord(test) {
			var orig_record = sample_tickets[0];
			this.unbase.search( "myapp", "status:open", {}, function(err, data) {
				test.ok( !err, "No error searching record: " + err );
				test.ok( !!data, "Got data in response" );
				test.ok( !!data.records, "Got data.records in response" );
				test.ok( !!data.total, "Got data.total in response" );
				test.ok( data.total == 1, "data.total is correct: " + data.total );
				test.ok( data.records.length == 1, "data.records.length in correct: " + data.records.length );
				test.ok( data.records[0].ID === orig_record.ID, "Record ID is correct: " + data.records[0].ID );
				test.ok( !!data.perf, "No perf in response" );
				test.debug("Perf", data.perf.metrics());
				test.done();
			} );
		},
		
		function testSearchFalse(test) {
			var orig_record = sample_tickets[0];
			this.unbase.search( "myapp", "status:closed", {}, function(err, data) {
				test.ok( !err, "No error searching record: " + err );
				test.ok( !!data, "Got data in response" );
				test.ok( !!data.records, "Got data.records in response" );
				test.ok( data.total == 0, "data.total is correct: " + data.total );
				test.ok( data.records.length == 0, "data.records.length in correct: " + data.records.length );
				test.done();
			} );
		},
		
		function testUpdateRecord(test) {
			var record = sample_tickets[0];
			record.Status = 'Closed';
			this.unbase.insert( "myapp", record.ID, record, function(err) {
				test.ok( !err, "No error updating record: " + err );
				test.done();
			} );
		},
		
		function testGetRecordAfterUpdate(test) {
			var orig_record = sample_tickets[0];
			this.unbase.get( "myapp", orig_record.ID, function(err, record) {
				test.ok( !err, "No error inserting record: " + err );
				test.ok( !!record, "Got record in response" );
				test.ok( record.ID === orig_record.ID, "Record ID is correct: " + record.ID );
				test.ok( record.Status === "Closed", "Record Status is correct: " + record.Status );
				test.done();
			} );
		},
		
		function testDeleteRecord(test) {
			var record = sample_tickets[0];
			this.unbase.delete( "myapp", record.ID, function(err) {
				test.ok( !err, "No error deleting record: " + err );
				
				// reset this for further tests
				record.Status = 'Open';
				
				test.done();
			} );
		},
		
		function testGetRecordFail(test) {
			var orig_record = sample_tickets[0];
			this.unbase.get( "myapp", orig_record.ID, function(err, record) {
				test.ok( !!err, "Error was expected getting non-existent record");
				test.ok( !record, "no record in response" );
				test.done();
			} );
		},
		
		function testBulkInsert(test) {
			var records = sample_tickets.map( function(data) {
				return { id: data.ID, data: data };
			} );
			
			this.unbase.bulkInsert( "myapp", records, function(err) {
				test.ok( !err, "No error inserting bulk: " + err );
				test.done();
			} );
		},
		
		function testSearchRecords(test) {
			this.unbase.search( "myapp", "status:open", {}, function(err, data) {
				test.ok( !err, "No error searching records: " + err );
				test.ok( !!data, "Got data in response" );
				test.ok( !!data.records, "Got data.records in response" );
				test.ok( !!data.total, "Got data.total in response" );
				test.ok( data.total == 2, "data.total is correct: " + data.total );
				test.ok( data.records.length == 2, "data.records.length in correct: " + data.records.length );
				test.ok( data.records[0].ID === "2653", "Record ID #0 is correct: " + data.records[0].ID );
				test.ok( data.records[1].ID === "2654", "Record ID #1 is correct: " + data.records[1].ID );
				test.done();
			} );
		},
		
		function testAddField(test) {
			var field = {
				id: "num_comments",
				source: "/Comments/Comment/length",
				type: "number"
			};
			
			this.unbase.addField( "myapp", field, function(err) {
				test.ok( !err, "No error adding field: " + err );
				test.done();
			} );
		},
		
		function testSearchRecordsAfterAddField(test) {
			// 2656
			this.unbase.search( "myapp", "num_comments:1", {}, function(err, data) {
				test.ok( !err, "No error searching records: " + err );
				test.ok( !!data, "Got data in response" );
				test.ok( !!data.records, "Got data.records in response" );
				test.ok( !!data.total, "Got data.total in response" );
				test.ok( data.total == 1, "data.total is correct: " + data.total );
				test.ok( data.records.length == 1, "data.records.length in correct: " + data.records.length );
				test.ok( data.records[0].ID === "2656", "Record ID #0 is correct: " + data.records[0].ID );
				test.done();
			});
		},
		
		function testSearchSummaryFail(test) {
			// this should fail here because status field has no master_list (yet)
			this.unbase.search( "myapp", "#summary:status", {}, function(err, data) {
				test.ok( !!err, "Error is expected getting field summary without master_list" );				
				test.done();
			});
		},
		
		function testUpdateField(test) {
			// add master_list back into status
			var field = {
				id: "status",
				source: "/Status",
				master_list: 1
			};
			
			this.unbase.updateField( "myapp", field, function(err) {
				test.ok( !err, "No error updating field: " + err );
				test.done();
			} );
		},
		
		function testSearchSummary(test) {
			this.unbase.search( "myapp", "#summary:status", {}, function(err, data) {
				test.debug( "DATA: ", data );
				test.ok( !err, "No error getting field summary: " + err );
				test.ok( !!data, "Got data in response" );
				test.ok( !!data.values, "Got data.values in response" );
				test.ok( data.values.open === 2, "data.values.open expects 2: " + data.values.open );
				test.ok( data.values.closed === 11, "data.values.closed expects 11: " + data.values.closed );				
				test.done();
			});
		},
		
		function testDeleteField(test) {
			this.unbase.deleteField( "myapp", "num_comments", function(err) {
				test.ok( !err, "No error deleting field: " + err );
				test.done();
			});
		},
		
		function testSearchRecordsAfterDeleteField(test) {
			// Note: when using simple queries, there is no "error" emitted for invalid query, only empty results
			this.unbase.search( "myapp", "num_comments:1", {}, function(err, data) {
				test.ok( !err, "No error searching non-existent field: " + err );
				test.ok( !!data, "Got data in response" );
				test.ok( !!data.records, "Got data.records in response" );
				test.ok( data.total === 0, "data.total is 0: " + data.total );
				test.done();
			});
		},
		
		function testSearchRecordsAfterDeleteFieldPxQL(test) {
			// Note: when using PxQL queries, we should expect error for invalid query
			this.unbase.search( "myapp", '(num_comments = 1)', {}, function(err, data) {
				test.ok( !!err, "Error expected searching non-existent field with PxQL" );
				test.done();
			});
		},
		
		function testAddSorter(test) {
			var sorter = {
				id: "created",
				source: "/Modifydate", // deliberately pointed to wrong source
				// source: "/Createdate",
				type: "number"
			};
			
			this.unbase.addSorter( "myapp", sorter, function(err) {
				test.ok( !err, "No error adding sorter: " + err );
				test.done();
			});
		},
		
		function testSearchWithSorter(test) {
			this.unbase.search( "myapp", "status:closed", { sort_by: "created", sort_dir: 1 }, function(err, data) {
				test.ok( !err, "No error performing search: " + err );
				test.ok( !!data, "Got data in response" );
				test.ok( !!data.records, "Got data.records in response" );
				test.ok( !!data.total, "Got data.total in response" );
				test.ok( data.total == 11, "data.total is correct: " + data.total );
				test.ok( data.records.length == 11, "data.records.length in correct: " + data.records.length );
				
				var last_date = 0;
				data.records.forEach( function(record) {
					record.Modifydate = parseInt( record.Modifydate ); // deliberately using wrong field here
					test.ok( record.Modifydate >= last_date, "Record has ascending <<modify>> date: " + record.Modifydate );
					last_date = record.Modifydate;
				} );
				
				test.done();
			});
		},
		
		function testUpdateSorter(test) {
			var sorter = {
				id: "created",
				source: "/Createdate", // corrected
				type: "number"
			};
			
			this.unbase.updateSorter( "myapp", sorter, function(err) {
				test.ok( !err, "No error updating sorter: " + err );
				test.done();
			});
		},
		
		function testSearchWithSorterAfterUpdate(test) {
			this.unbase.search( "myapp", "status:closed", { sort_by: "created", sort_dir: 1 }, function(err, data) {
				test.ok( !err, "No error performing search: " + err );
				test.ok( !!data, "Got data in response" );
				test.ok( !!data.records, "Got data.records in response" );
				test.ok( !!data.total, "Got data.total in response" );
				test.ok( data.total == 11, "data.total is correct: " + data.total );
				test.ok( data.records.length == 11, "data.records.length in correct: " + data.records.length );
				
				var last_created = 0;
				data.records.forEach( function(record) {
					record.Createdate = parseInt( record.Createdate );
					test.ok( record.Createdate >= last_created, "Record has ascending create date: " + record.Createdate );
					last_created = record.Createdate;
				} );
				
				test.done();
			});
		},
		
		function testDeleteSorter(test) {
			this.unbase.deleteSorter( "myapp", 'created', function(err) {
				test.ok( !err, "No error deleting sorter: " + err );
				test.done();
			});
		},
		
		function testSubscribe(test) {
			test.timeout( 3000 );
			
			this.sub = this.unbase.subscribe( "myapp", "status:closed", { offset: 0, limit: 10 } );
			
			this.sub.once('change', function(data) {
				test.ok( true, "Got initial change event" );
				test.ok( !!data, "Got data in change event" );
				test.ok( !!data.records, "Got data.records in change event" );
				test.ok( data.total == 11, "data.total is 11: " + data.total );
				test.ok( data.records.length == 10, "data.records.length is 10: " + data.records.length );
				test.ok( data.records[0].ID == "2655", "First record has correct ID: " + data.records[0].ID );
				test.done();
			});
		},
		
		function testSubAddRecord(test) {
			test.expect( 7 );
			test.timeout( 3000 );
			
			this.sub.once('change', function(data) {
				test.ok( true, "Got change event" );
				test.ok( !!data, "Got data in change event" );
				test.ok( !!data.records, "Got data.records in change event" );
				test.ok( data.total == 12, "data.total is 12: " + data.total );
				test.ok( data.records.length == 10, "data.records.length is 10: " + data.records.length );
				test.ok( data.records[0].ID == "2653", "First record has correct ID: " + data.records[0].ID );
				test.done();
			});
			
			var record = sample_tickets[0];
			record.Status = 'Closed';
			this.unbase.insert( "myapp", record.ID, record, function(err) {
				test.ok( !err, "No error updating record: " + err );
			} );
		},
		
		function testSubRemoveRecord(test) {
			test.expect( 7 );
			test.timeout( 3000 );
			
			this.sub.once('change', function(data) {
				test.ok( true, "Got change event" );
				test.ok( !!data, "Got data in change event" );
				test.ok( !!data.records, "Got data.records in change event" );
				test.ok( data.total == 11, "data.total is 11: " + data.total );
				test.ok( data.records.length == 10, "data.records.length is 10: " + data.records.length );
				test.ok( data.records[0].ID == "2655", "First record has correct ID: " + data.records[0].ID );
				test.done();
			});
			
			var record = sample_tickets[0];
			record.Status = 'Open';
			this.unbase.insert( "myapp", record.ID, record, function(err) {
				test.ok( !err, "No error updating record: " + err );
			} );
		},
		
		function testSubChangeRecord(test) {
			test.expect( 8 );
			test.timeout( 3000 );
			
			this.sub.once('change', function(data) {
				test.ok( true, "Got change event" );
				test.ok( !!data, "Got data in change event" );
				test.ok( !!data.records, "Got data.records in change event" );
				test.ok( data.total == 11, "data.total is 11: " + data.total );
				test.ok( data.records.length == 10, "data.records.length is 10: " + data.records.length );
				test.ok( data.records[0].ID == "2655", "First record has correct ID: " + data.records[0].ID );
				test.ok( data.records[0].Summary == "Watermelons", "First record has updated summary: " + data.records[0].Summary );
				test.done();
			});
			
			var record = Tools.findObject( sample_tickets, { ID: "2655" } );
			record.Summary = 'Watermelons';
			this.unbase.insert( "myapp", record.ID, record, function(err) {
				test.ok( !err, "No error updating record: " + err );
			} );
		},
		
		function testSubNonChange(test) {
			test.expect( 2 );
			
			var timer = setTimeout( function() {
				// good, we want this to fire, and NOT the change event
				test.ok( true, "Timeout fired (expected)" );
				test.done();
			}, 1000 );
			
			this.sub.once('change', function(data) {
				clearTimeout( timer );
				test.ok( false, "Got change event (not expected)" );
			});
			
			var record = sample_tickets[0]; // not currently part of live set
			record.Summary = 'Unit Test Changed';
			this.unbase.insert( "myapp", record.ID, record, function(err) {
				test.ok( !err, "No error updating record: " + err );
			} );
		},
		
		function testUnsubscribe(test) {
			this.sub.removeAllListeners('change');
			
			var timer = setTimeout( function() {
				// good, we want this to fire, and NOT the change event
				test.ok( true, "Timeout fired (expected)" );
				test.done();
			}, 1000 );
			
			this.sub.once('change', function(data) {
				clearTimeout( timer );
				test.ok( false, "Got change event (not expected)" );
			});
			
			this.sub.unsubscribe();
			
			var record = Tools.findObject( sample_tickets, { ID: "2655" } );
			record.Summary = 'Cantaloupe';
			this.unbase.insert( "myapp", record.ID, record, function(err) {
				test.ok( !err, "No error updating record: " + err );
			} );
		},
		
		function testDeleteIndex(test) {
			this.unbase.deleteIndex( "myapp", function(err) {
				test.ok( !err, "No error deleting index: " + err );
				test.done();
			} );
		}
		
	],
	
	tearDown: function (callback) {
		// clean up
		this.server.shutdown( function() {
			cp.exec("rm -rf " + base_data_dir, callback);
		} );
	}
	
};
