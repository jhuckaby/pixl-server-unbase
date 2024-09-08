# Overview

Unbase is a component for use in [pixl-server](https://github.com/jhuckaby/pixl-server).  It implements a database-like system, built on top of [pixl-server-storage](https://github.com/jhuckaby/pixl-server-storage).  It is basically a thin wrapper around the [Indexer](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md), with some additional record storage, database management and live search capabilities.

The main idea behind Unbase is to provide a database (or something sort of like one) on top of simple JSON files on disk (or S3 if you are insane).  Both the record data and the indexes are built out of simple JSON documents.  It uses as little memory as possible, at the cost of speed.

This component does not implement any sort of external API, nor user authentication.  It is merely an internal programmatic API to a database-like system, which can be embedded into an application or higher level database.  Unbase is a single-master database (only one process can do writes at a time), as all locks and transactions are RAM-based.  Also see [Indexer Caveats](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#caveats).

## Features at a Glance

- Database management and data storage services.
- Stores JSON records which can be retrieved by ID.
- Database-like "tables" (called indexes) which can be searched.
- Both [simple](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#simple-queries) and [complex](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#pxql-queries) query languages are supported.
- Supports Google-style full-text search queries, with exact phrase matching.
- Live search queries which can be "subscribed" to.

## Table of Contents

<!-- toc -->
- [Usage](#usage)
- [Configuration](#configuration)
	* [indexes](#indexes)
	* [base_path](#base_path)
- [Basic Functions](#basic-functions)
	* [Creating, Updating and Deleting Indexes](#creating-updating-and-deleting-indexes)
	* [Adding, Updating and Deleting Fields](#adding-updating-and-deleting-fields)
	* [Adding, Updating and Deleting Sorters](#adding-updating-and-deleting-sorters)
	* [Inserting, Updating and Deleting Records](#inserting-updating-and-deleting-records)
		+ [Bulk Operations](#bulk-operations)
	* [Fetching Records](#fetching-records)
	* [Searching](#searching)
	* [Live Search](#live-search)
		+ [Live Summaries](#live-summaries)
	* [Jobs](#jobs)
- [API](#api)
	* [getIndex](#getindex)
	* [createIndex](#createindex)
	* [updateIndex](#updateindex)
	* [reindex](#reindex)
	* [deleteIndex](#deleteindex)
	* [addField](#addfield)
	* [updateField](#updatefield)
	* [deleteField](#deletefield)
	* [addSorter](#addsorter)
	* [updateSorter](#updatesorter)
	* [deleteSorter](#deletesorter)
	* [insert](#insert)
	* [update](#update)
	* [delete](#delete)
	* [get](#get)
	* [bulkInsert](#bulkinsert)
	* [bulkUpdate](#bulkupdate)
	* [bulkDelete](#bulkdelete)
	* [search](#search)
	* [subscribe](#subscribe)
	* [getStats](#getstats)
	* [Subscriber](#subscriber)
		+ [Event: change](#event-change)
		+ [Event: error](#event-error)
		+ [Event: destroy](#event-destroy)
		+ [Method: changeOptions](#method-changeoptions)
		+ [Method: unsubscribe](#method-unsubscribe)
- [Logging](#logging)
- [License](#license)

# Usage

Use [npm](https://www.npmjs.com/) to install the module:

```sh
npm install pixl-server pixl-server-storage pixl-server-unbase
```

Here is a simple usage example.  Note that the component's official name is `Unbase`, so that is what you should use for the configuration key, and for gaining access to the component via your server object.

```js
const PixlServer = require('pixl-server');
let server = new PixlServer({
	
	__name: 'MyServer',
	__version: "1.0",
	
	config: {
		"log_dir": "/let/log",
		"debug_level": 9,
		
		"Storage": {
			"engine": "Filesystem",
			"Filesystem": {
				"base_dir": "/let/data/myapp",
			},
			"transactions": true
		},
		
		"Unbase": {
			"indexes": {
				"myapp": {
					"fields": [
						{
							"id": "body",
							"source": "/BodyText",
							"min_word_length": 3,
							"max_word_length": 64,
							"use_remove_words": true,
							"use_stemmer": true,
							"filter": "html"
						},
						{
							"id": "modified",
							"source": "/ModifyDate",
							"type": "date"
						},
						{
							"id": "tags",
							"source": "/Tags",
							"master_list": true
						}
					],
					"remove_words": ["the", "of", "and", "a", "to", "in", "is", "you", "that", "it", "he", "was", "for", "on", "are", "as", "with", "his", "they"]
				}
			}
		}
	},
	
	components: [
		require('pixl-server-storage'),
		require('pixl-server-unbase')
	]
	
});

server.startup( function() {
	// server startup complete
	let unbase = server.Unbase;
	
	// setup record object
	let record = {
		"BodyText": "This is the body text of my ticket, which <b>may contain HTML</b> and \nmultiple\nlines.\n",
		"ModifyDate": "2018/01/07",
		"Tags": "bug, assigned, open"
	};
	
	// Insert it!
	unbase.insert( "myapp", "TICKET0001", record, function(err) {
		// record is fully indexed
		if (err) throw err;
		
		// search for it
		unbase.search( "myapp", "body:This is the body text of my ticket", function(err, data) {
			if (err) throw err;
			
			// data.records will be an array of results
			// data.records[0].ModifyDate == "2018/01/07"
			
		} ); // search
	} ); // insert
} ); // startup
```

Notice how we are loading the [pixl-server](https://github.com/jhuckaby/pixl-server) parent module, and then specifying [pixl-server-storage](https://github.com/jhuckaby/pixl-server-storage) and [pixl-server-unbase](https://github.com/jhuckaby/pixl-server-unbase) as components:

```js
components: [
	require('pixl-server-storage'),
	require('pixl-server-unbase')
]
```

This example is a very simple server configuration, which will start a local filesystem storage instance pointed at `/let/data/myapp` as a base directory.  It then inserts a single record, and searches for it.

It is highly recommended that you enable [transaction support](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Transactions.md) in your [pixl-server-storage](https://github.com/jhuckaby/pixl-server-storage) configuration.  This ensures that your data will never become corrupted in the event of a sudden power loss or crash.

# Configuration

The configuration for this component is set by passing in a `Unbase` key in the `config` element when constructing the `PixlServer` object, or, if a JSON configuration file is used, a `Unbase` object at the outermost level of the file structure.  It can contain the following keys:

## indexes

The optional `indexes` property allows you to bootstrap indexes, so they are ready to go instantly, without having to orchestrate API calls to [createIndex()](#createindex) from an install script or setup UI.  The property should be an object with keys corresponding to each index you want to bootstrap.  Each key should contain a full index configuration (see [Indexer Configuration](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#configuration) for full details).  Example:

```json
{
	"indexes": {
		"myapp": {
			"fields": [
				{
					"id": "body",
					"source": "/BodyText",
					"min_word_length": 3,
					"max_word_length": 64,
					"use_remove_words": true,
					"use_stemmer": true,
					"filter": "html"
				},
				{
					"id": "modified",
					"source": "/ModifyDate",
					"type": "date"
				},
				{
					"id": "tags",
					"source": "/Tags",
					"master_list": true
				}
			],
			"remove_words": ["the", "of", "and", "a", "to", "in", "is", "you", "that", "it", "he", "was", "for", "on", "are", "as", "with", "his", "they"]
		}
	}
}
```

This would bootstrap an index with ID `myapp`, containing 2 fields and a sorter.

Please note that bootstrapped index configurations can be overridden by any of the management API calls below, such as [addField()](#addfield), [deleteField()](#deletefield) or other.  Once any of these management routines are called on a bootstrapped index, it is essentially forked, and committed to and read from storage from that point on.

## base_path

The optional `base_path` property allows you to specify a custom storage key prefix for all Unbase related records.  It defaults to `unbase`.  Your indexes will all be located under this base path, followed by the word `index`, followed by the Index ID key itself, all separated by slashes.  Example: `unbase/index/myapp`.

# Basic Functions

The code examples all assume you have your preloaded `Unbase` component instance in a local variable named `unbase`.  The component instance can be retrieved from a running server like this:

```js
let unbase = server.Unbase;
```

## Creating, Updating and Deleting Indexes

For creating indexes, you have two options.  You can either "bootstrap" the index by specifying its definition in the configuration (see above), or you can programmatically create an index at any time.  For the latter, use the [createIndex()](#createindex) method:

```js
let index = {
	"fields": [
		{
			"id": "body",
			"source": "/BodyText",
			"use_stemmer": true,
			"filter": "html"
		},
		{
			"id": "modified",
			"source": "/ModifyDate",
			"type": "date"
		},
		{
			"id": "tags",
			"source": "/Tags",
			"master_list": true
		}
	]
};

unbase.createIndex( "myapp", index, function(err) {
	if (err) throw err;
} );
```

This would create a new index with key `myapp`, containing 3 fields.  As soon as the callback is fired, the index is ready to use.  The index is also committed to disk, so upon a restart it will be auto-loaded and ready to use every time.

To update an index, use the [updateIndex()](#updateindex) method.  Note that this is currently only for adding or updating [remove words](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#remove-words).  If you want to make other changes to your index, such as field or sorter changes, see the following two sections.  Example update:

```js
let updates = {
	"remove_words": ["the", "of", "and", "a", "to", "in", "is", "you", "that", "it", "he", "was", "for", "on", "are", "as", "with", "his", "they"]
};

unbase.updateIndex( "myapp", updates, function(err) {
	if (err) throw err;
} );
```

To delete an index, use the [deleteIndex()](#deleteindex) method.  Note that this also deletes **all data records** for the index.  Please use with extreme care.  You only need to specify the Index ID and an optional callback.  Example:

```js
unbase.deleteIndex( "myapp", function(err) {
	if (err) throw err;
} );
```

If the index has any associated records, this spawns a background job to delete them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

## Adding, Updating and Deleting Fields

You can add, update or delete fields on-the-fly, and your records will automatically be reindexed.  To add a new field, call [addField()](#addfield).  Example:

```js
let field = {
	"id": "status",
	"source": "/Status",
	"master_list": true
};

unbase.addField( "myapp", field, function(err) {
	if (err) throw err;
} );
```

This would add a new field to the index `myapp` with ID `status`.  If the index has any associated records, this spawns a background job to reindex them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

To update an existing field, call [updateField()](#updatefield).  You cannot change the field ID, but you can change any other properties, or add/remove them.  Example:

```js
let field = {
	"id": "status",
	"source": "/Status",
	"master_list": true,
	"default_value": "Closed"
};

unbase.updateField( "myapp", field, function(err) {
	if (err) throw err;
} );
```

This would update the `status` field in the `myapp` index, adding a new property: `default_value`.  If the index has any associated records, this spawns a background job to reindex them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

To remove a field from an index, call [deleteField()](#deletefield).  You only need to specify the field ID in this case, not the entire field object.  Example:

```js
unbase.deleteField( "myapp", "status", function(err) {
	if (err) throw err;
} );
```

This would remove the `status` field from the `myapp` index.  If the index has any associated records, this spawns a background job to reindex them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

## Adding, Updating and Deleting Sorters

You can add, update or delete [sorters](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#sorting-results) on-the-fly, and your records will automatically be reindexed.  To add a new sorter, call [addSorter()](#addsorter).  Example:

```js
let sorter = {
	"id": "created",
	"source": "/Createdate",
	"type": "number"
};

unbase.addSorter( "myapp", sorter, function(err) {
	if (err) throw err;
} );
```

This would add a new sorter to the index `myapp` with ID `created`.  If the index has any associated records, this spawns a background job to reindex them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

To update an existing sorter, call [updateSorter()](#updatesorter).  You cannot change the sorter ID, but you can change any other properties, or add/remove them.  Example:

```js
let sorter = {
	"id": "created",
	"source": "/Created",
	"type": "number"
};

unbase.updateSorter( "myapp", sorter, function(err) {
	if (err) throw err;
} );
```

This would update the `created` field in the `myapp` index, changing the `source` property value.  If the index has any associated records, this spawns a background job to reindex them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

To remove a sorter from an index, call [deleteSorter()](#deletesorter).  You only need to specify the sorter ID in this case, not the entire sorter object.  Example:

```js
unbase.deleteSorter( "myapp", "created", function(err) {
	if (err) throw err;
} );
```

This would remove the `created` sorter from the `myapp` index.  If the index has any associated records, this spawns a background job to reindex them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

## Inserting, Updating and Deleting Records

To insert or update a single record, call [insert()](#insert).  This will store the entire data record (including data not processed by the indexer) and trigger an index on the data as well.  The callback is optional.  Example:

```js
let record = {
	"BodyText": "This is the body text of my record, which <b>may contain HTML</b> and \nmultiple\nlines.\n",
	"ModifyDate": "2018/01/07",
	"Tags": "bug, assigned, open"
};

unbase.insert( "myapp", "RECORD0001", record, function(err) {
	// record is fully indexed
	if (err) throw err;
} );
```

There is no separate "update" call.  Just call [insert()](#insert) if you want to update an existing record, but make sure you pass in the entire record data object each time (no sparsely populated objects).

To delete a record, call [delete()](#delete).  This deletes the record data itself, as well as all the associated index data.  You only need to specify the record ID to delete.  The callback is optional.  Example:

```js
unbase.delete( "myapp", "RECORD0001", function(err) {
	// record is deleted
	if (err) throw err;
} );
```

### Bulk Operations

If you have a list of multiple records to insert, update or delete, convenience methods are provided.  They also spawn background [Jobs](#jobs), so you can poll [getStats()](#getstats) to track progress.

For inserting or updating complete records in bulk, you can call [bulkInsert()](#bulkinsert), and provide an array containing exactly two properties per element: `id` and `data`.  The `id` property should contain the ID of the record, and the `data` should be the record itself (object).  Example:

```js
let records = [
	{
		"id": "RECORD0001",
		"data": {
			"BodyText": "This is the body text of my record, which <b>may contain HTML</b> and \nmultiple\nlines.\n",
			"ModifyDate": "2018/01/07",
			"Tags": "bug, assigned, open"
		}
	},
	{
		"id": "RECORD0002",
		"data": {
			"BodyText": "This is more sample body text",
			"ModifyDate": "2018/01/08",
			"Tags": "bug, closed"
		}
	}
];

let job_id = unbase.bulkInsert( 'myapp', records, function(err) {
	if (err) throw err;
} );
```

The callback is optional.  You can omit it, and instead track job progress by polling [getStats()](#getstats).  The method returns an alphanumeric Job ID.

When you want to apply the same sparse updates to a set of records in bulk, use [bulkUpdate()](#bulkupdate).  This API expects an array of records IDs, and an object containing the sparse updates you want to apply.  Example:

```js
let records = [ 
	"RECORD0001", 
	"RECORD0002" 
];
let updates = {
	"Tags": "bug, closed"
};

let job_id = unbase.bulkUpdate( 'myapp', records, updates, function(err) {
	if (err) throw err;
} );
```

The callback is optional.  You can omit it, and instead track job progress by polling [getStats()](#getstats).  The method returns an alphanumeric Job ID.

To perform a bulk delete, call [bulkDelete()](#bulkdelete), and provide an array of record IDs.  Example:

```js
let records = [ 
	"RECORD0001", 
	"RECORD0002"
];

let job_id = unbase.bulkDelete( 'myapp', records, function(err) {
	if (err) throw err;
} );
```

The callback is optional.  You can omit it, and instead track job progress by polling [getStats()](#getstats).  The method returns an alphanumeric Job ID.

## Fetching Records

To fetch records by ID, call the [get()](#get) method.  You can pass either a single record, or an array of multiple.  Examples:

```js
unbase.get( 'myapp', "RECORD0001", function(err, record) {
	if (err) throw err;
	// record will contain your data
	console.log("Record: ", record);
} );

unbase.get( 'myapp', ["RECORD0001", "RECORD0002"], function(err, records) {
	if (err) throw err;
	// records will be an array of data objects
	console.log("Records: ", records);
} );
```

When fetching multiple records, the array elements in `records` will correspond to the order you specified in the ID array.

## Searching

To perform an index search, call the [search()](#search) method.  You need to provide the index ID, and a search query (either in [simple](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#simple-queries) or [PxQL](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#pxql-queries) format), some options like offset and limit, and a callback.  Example:

```js
unbase.search( 'myapp', 'tags:open', { offset: 0, limit: 10 }, function(err, data) {
	if (err) throw err;
	// data.records is a sorted array of records in our offset/limit
	// data.total is the total number of records matched (ignoring our limit)
} );
```

This would find all records that have `open` in their `tags` field, and return the first 10 records at offset 0.  By default the records are sorted by their IDs (ascending).  However, you can provide your own sorting options:

```js
let opts = { 
	offset: 0, 
	limit: 10,
	sort_by: "created",
	sort_dir: -1
};

unbase.search( 'myapp', 'tags:open', opts, function(err, data) {
	if (err) throw err;
	// data.records is a sorted array of records in our offset/limit
	// data.total is the total number of records matched (ignoring our limit)
} );
```

This would perform the same search as the above example, but this time it will sort the records using the `created` sorter field (see [Sorting Results](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#sorting-results)), and sort in reverse (descending) order.

## Live Search

In addition to performing single index searches, you can also "subscribe" to a search, and be notified when your result set changes.  This includes records getting added, deleted or updated within your offset/limit.  To subscribe to a search, call [subscribe()](#subscribe), and pass in the same arguments as [search()](#search), but omit the callback.  The method returns a special [Subscriber](#subscriber) object, which you can attach event listeners to.  Example use:

```js
let sub = unbase.subscribe( 'myapp', 'tags:open', { offset: 0, limit: 10 } );

sub.on('change', function(data) {
	// our search results have changed
	// data.records is a sorted array of records in our offset/limit
	// data.total is the total number of records matched (ignoring our limit)
});
```

The [change](#event-change) event is fired every time your search results change, including immediately after subscribing (for the initial result set).  The engine is smart enough to only fire a change event if your result set is affected, which includes:

- **Adding records**
	- The total count has changed, so this may affect your pagination.
	- Also, due to sorting, the new record may appear within the sub's view (offset/limit), or *before* it, causing a shift in the visible records.
- **Deleting records**
	- The total count has changed, so this may affect your pagination.
	- Also, due to sorting, the old record may disappear from within the sub's view (offset/limit), or *before* it, causing a shift in the visible records.
- **Updating records (in certain cases)**
	- An updated record only fires a change event if its sort order has changed, or the record is within the sub's view (offset/limit).

Search errors can throw, i.e. for an invalid query (syntax error, missing field, bad index, etc.), so you might want to wrap the call to [subscribe()](#subscribe) in a try/catch.  However, if the error is *asynchronous*, like a storage related error of some kind, then an [error](#event-error) event will be emitted, which the subscriber can listen for.

If your subscription has to be destroyed outside of your control (for example due to a major database change event, like removing a field), then a [destroy](#event-destroy) event is emitted.

Make sure to keep track of all your subscriber objects, and call [unsubscribe()](#method-unsubscribe) on them to discard.  The search results that feed the subscribers are all kept in memory, so this can quickly add up.

### Live Summaries

In addition to subscribing to live *record* searches, you can also subscribe to live [field summaries](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#field-summaries).  If you have any fields indexed with the [master list](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#master-list) feature enabled, you can subscribe to a "summary" of the data values.  This yields a hash containing all the unique words from the index, and their total counts (occurrences) across all your records.

To subscribe to a field summary, use the same [subscribe()](#subscribe) method, but send in this special query syntax: `#summary:FIELDID`.  Also, you can omit the options object.  Example use:

```js
let sub = unbase.subscribe( 'myapp', '#summary:status' );

sub.on('change', function(data) {
	// our field summary has changed
	// data.values is a hash containing all the unique words from the index
});
```

As you can see, field summary subscriptions also emit [change](#event-change) events, and otherwise behave very similarly to record based search subscriptions.

## Jobs

Certain operations on the database may cause a "reindex", where the engine must iterate over all records and update them.  These types of ops spawn a "job" which is an internal tracking system for long-running tasks.  To poll active jobs, call the [getStats()](#getstats) method.  This returns a variety of stats about the storage engine, but also a `jobs` property, which describes all active jobs.  Example:

```js
let stats = unbase.getStats();
```

Example stats output:

```json
{
	"jobs": {
		"ji54bekr02": {
			"id": "ji54bekr02",
			"index": "myapp",
			"title": "Adding new field: status",
			"start": 1528418724.0,
			"progress": 0.5
		}
	}
}
```

The top-level `jobs` property contains an object for every active job, keyed by the job's unique ID.  Each job will have the following properties:

| Property | Type | Description |
|----------|------|-------------|
| `id` | String | A unique alphanumeric ID for the job (auto-assigned). |
| `index` | String | The Index ID that the job pertains to (e.g. `myapp`). |
| `title` | String | A title or summary of the job. |
| `start` | Number | Epoch timestamp of when the job started. |
| `progress` | Number | Progress of job from `0.0` to `1.0`. |

See [Performance Metrics](https://github.com/jhuckaby/pixl-server-storage#performance-metrics) for details on the other properties provided in the [getStats()](#getstats) response.

The following API calls will spawn a background job: [createIndex()](#createindex), [reindex()](#reindex), [deleteIndex()](#deleteindex), [addField()](#addfield), [updateField()](#updatefield), [deleteField()](#deletefield), [addSorter()](#addsorter), [updateSorter()](#updatesorter), [deleteSorter()](#deletesorter), [bulkInsert()](#bulkinsert), and [bulkDelete()](#bulkdelete).

# API

## getIndex

```js
unbase.getIndex( INDEX_ID );
```

The `getIndex()` method fetches a [Index Configuration](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#configuration) object given its ID, and returns it.  This is a synchronous method, as all indexes are stored in memory.  Example:

```js
let index = unbase.getIndex("myapp");
```

## createIndex

```js
unbase.createIndex( INDEX_ID, INDEX, [CALLBACK] );
```

The `createIndex()` method creates a new index.  Pass in a unique Index ID (alphanumeric lower-case), and an [Index Configuration](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#configuration) object.  The callback is optional.  Example:

```js
let index = {
	"fields": [
		{
			"id": "body",
			"source": "/BodyText",
			"use_stemmer": true,
			"filter": "html"
		},
		{
			"id": "modified",
			"source": "/ModifyDate",
			"type": "date"
		},
		{
			"id": "tags",
			"source": "/Tags",
			"master_list": true
		}
	]
};

unbase.createIndex( "myapp", index, function(err) {
	if (err) throw err;
} );
```

This would create a new index with key `myapp`, containing 3 fields.  As soon as the callback is fired, the index is ready to use.  The index is also committed to disk, so upon a restart it will be auto-loaded and ready to use every time.

## updateIndex

```js
unbase.updateIndex( INDEX_ID, UPDATES, [CALLBACK] );
```

The `updateIndex()` method updates an existing index.  Note that this is currently only for adding or updating [remove words](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#remove-words), but any properties are accepted for future use.  Example:

```js
let updates = {
	"remove_words": ["the", "of", "and", "a", "to", "in", "is", "you", "that", "it", "he", "was", "for", "on", "are", "as", "with", "his", "they"]
};

unbase.updateIndex( "myapp", updates, function(err) {
	if (err) throw err;
} );
```

## reindex

```js
unbase.reindex( INDEX_ID, FIELD_IDS, [CALLBACK] );
```

The `reindex()` method performs a reindex operation on a specified index.  A reindex will essentially rebuild the internal index metadata.  You should only need this under special circumstances.  You can specify which field(s) to reindex, or set to any false value for all fields.  Example:

```js
unbase.reindex( "myapp", ["body", "tags"], function(err) {
	if (err) throw err;
} );
```

This would reindex the `body` and `tags` fields in all records for the `myapp` index.

This method spawns a background job to perform the reindex.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

## deleteIndex

```js
unbase.deleteIndex( INDEX_ID, [CALLBACK] );
```

The `deleteIndex()` method deletes an existing index **and all associated data records**.  Please use with extreme care.  You only need to specify the Index ID and an optional callback.  Example:

```js
unbase.deleteIndex( "myapp", function(err) {
	if (err) throw err;
} );
```

If the index has any associated records, this spawns a background job to delete them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

## addField

```js
unbase.addField( INDEX_ID, FIELD, [CALLBACK] );
```

The `addField()` method adds a new field to an existing index.  Pass in the Index ID, and a [Field Configuration](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#configuration) object.  The callback is optional.  Example:

```js
let field = {
	"id": "status",
	"source": "/Status",
	"master_list": true
};

unbase.addField( "myapp", field, function(err) {
	if (err) throw err;
} );
```

This would add a new field to the index `myapp` with ID `status`.  If the index has any associated records, this spawns a background job to reindex them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

## updateField

```js
unbase.updateField( INDEX_ID, FIELD, [CALLBACK] );
```

The `updateField()` method updates an existing field.  Pass in the Index ID, and a [Field Configuration](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#configuration) object.  You cannot change the field ID, but you can change any other properties, or add/remove them.  The callback is optional.  Example:

```js
let field = {
	"id": "status",
	"source": "/Status",
	"master_list": true,
	"default_value": "Closed"
};

unbase.updateField( "myapp", field, function(err) {
	if (err) throw err;
} );
```

This would update the `status` field in the `myapp` index, adding a new property: `default_value`.  If the index has any associated records, this spawns a background job to reindex them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

## deleteField

```js
unbase.deleteField( INDEX_ID, FIELD_ID, [CALLBACK] );
```

The `deleteField()` method removes a field from an index, and reindexes all records to remove the field data.  You only need to specify the field ID in this case, not the entire field object.  The callback is optional.  Example:

```js
unbase.deleteField( "myapp", "status", function(err) {
	if (err) throw err;
} );
```

This would remove the `status` field from the `myapp` index.  If the index has any associated records, this spawns a background job to reindex them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

## addSorter

```js
unbase.addSorter( INDEX_ID, SORTER, [CALLBACK] );
```

The `addSorter()` method adds a new [sorter](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#sorting-results) to an existing index.  The callback is optional.  Example:

```js
let sorter = {
	"id": "created",
	"source": "/Createdate",
	"type": "number"
};

unbase.addSorter( "myapp", sorter, function(err) {
	if (err) throw err;
} );
```

This would add a new sorter to the index `myapp` with ID `created`.  If the index has any associated records, this spawns a background job to reindex them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

## updateSorter

```js
unbase.updateSorter( INDEX_ID, SORTER, [CALLBACK] );
```

The `updateSorter()` method updates an existing [sorter](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#sorting-results).  You cannot change the sorter ID, but you can change any other properties, or add/remove them.  The callback is optional.  Example:

```js
let sorter = {
	"id": "created",
	"source": "/Created",
	"type": "number"
};

unbase.updateSorter( "myapp", sorter, function(err) {
	if (err) throw err;
} );
```

This would update the `created` field in the `myapp` index, changing the `source` property value.  If the index has any associated records, this spawns a background job to reindex them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

## deleteSorter

```js
unbase.deleteSorter( INDEX_ID, SORTER_ID, [CALLBACK] );
```

The `deleteSorter()` method removes an existing [sorter](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#sorting-results), and reindexes all records to remove the sort data.  You only need to specify the sorter ID in this case, not the entire object.  The callback is optional.  Example:

```js
unbase.deleteSorter( "myapp", "created", function(err) {
	if (err) throw err;
} );
```

This would remove the `created` sorter from the `myapp` index.  If the index has any associated records, this spawns a background job to reindex them.  See [Jobs](#jobs) for more details on background jobs.  If you don't specify a callback, you can poll [getStats()](#getstats) to monitor active jobs.

## insert

```js
unbase.insert( INDEX_ID, RECORD_ID, RECORD, [CALLBACK] );
```

The `insert()` method stores an entire data record (possibly including data not processed by the indexer) and triggers an index on the data as well.  This works for new records, and updating existing records.  The callback is optional.  Example:

```js
let record = {
	"BodyText": "This is the body text of my record, which <b>may contain HTML</b> and \nmultiple\nlines.\n",
	"ModifyDate": "2018/01/07",
	"Tags": "bug, assigned, open"
};

unbase.insert( "myapp", "RECORD0001", record, function(err) {
	// record is fully indexed
	if (err) throw err;
} );
```

If you use [insert()](#insert) to update an existing record, make sure you pass in the *entire* record data object each time (no sparsely populated objects).

## update

```js
unbase.update( INDEX_ID, RECORD_ID, UPDATES, [CALLBACK] );
```

The `update()` method updates a data record (possibly including data not processed by the indexer) and triggers a reindex on the data as well.  The record data you pass here can be *sparsely populated*, i.e. you can specify only changed keys if you want.  Also, string values that begin with `+` or `-` have special meaning (see below).  The callback is optional.  Example:

```js
let updates = {
	"ModifyDate": "2018/01/08",
	"Tags": "feature, assigned, open"
};

unbase.update( "myapp", "RECORD0001", updates, function(err) {
	// record is now reindexed
	if (err) throw err;
} );
```

If your record contains any numerical values, and you pass in a replacement *string* that begins with a `+` or `-`, this is interpreted as a mathematical increment or decrement, respectively.  Example:

```js
unbase.update( "myapp", "RECORD0001", { "Replies": "+1" }, function(err) {
	// record is now reindexed
	if (err) throw err;
} );
```

If your record had a `Replies` property that contained a number, this update would *increment* that number by `1`.

For record fields that contain comma-separated words (often called "tags"), you can use the update mechanism to add (`+`) or remove (`-`) tags to the word list.  For example, in our `Tags` field shown above, let's remove the tag `open` and add the tag `closed`.  Here is how you would do that:

```js
unbase.update( "myapp", "RECORD0001", { "Tags": "-open, +closed" }, function(err) {
	// record is now reindexed
	if (err) throw err;
} );
```

Instead of passing an object containing properties to update, you can pass a function as the 3rd argument.  Your update function will be called after the existing record is fetched and locked, so you can manipulate the record using code.  Your function can then return the updates it wants to apply, or `false` to abort the transaction.  All the locking and transaction handling is transparent to the user.  Example:

```js
unbase.update( "myapp", "RECORD0001", 
	function(record) {
		// record has been locked and loaded
		return { BodyText: record.BodyText + " -- and we appended this!" };
	}, 
	function(err) {
		// record is now reindexed
		if (err) throw err;
	}
);
```

If your function returns `false`, the update is aborted, and the final callback (if provided) is invoked with the string `ABORT` as the sole argument.

## delete

```js
unbase.delete( INDEX_ID, RECORD_ID, [CALLBACK] );
```

The `delete()` method deletes one record, as well as all the associated index data.  You only need to specify the index ID and record ID to delete.  The callback is optional.  Example:

```js
unbase.delete( "myapp", "RECORD0001", function(err) {
	// record is deleted
	if (err) throw err;
} );
```

This would delete and completely unindex the record with ID `RECORD0001`.

## get

```js
unbase.get( INDEX_ID, RECORD_ID, CALLBACK );
```

The `get()` method fetches one or more records.  For fetching a single record, pass in the Index ID, record ID (string), and a callback.  Example:

```js
unbase.get( 'myapp', "RECORD0001", function(err, record) {
	if (err) throw err;
	// record will contain your data
	console.log("Record: ", record);
} );
```

To fetch multiple records at once, pass in an array of record IDs.  Example:

```js
unbase.get( 'myapp', ["RECORD0001", "RECORD0002"], function(err, records) {
	if (err) throw err;
	// records will be an array of data objects
	console.log("Records: ", records);
} );
```

In this case the array elements in `records` will correspond to the order you specified in the ID array.

## bulkInsert

```js
unbase.bulkInsert( INDEX_ID, RECORDS, [CALLBACK] );
```

The `bulkInsert()` method allows you to insert a large number of records all at once.  You need to provide an array containing exactly two properties per element: `id` and `data`.  The `id` property should contain the ID of the record, and the `data` should be the record itself (object).  Example:

```js
let records = [
	{
		"id": "RECORD0001",
		"data": {
			"BodyText": "This is the body text of my record, which <b>may contain HTML</b> and \nmultiple\nlines.\n",
			"ModifyDate": "2018/01/07",
			"Tags": "bug, assigned, open"
		}
	},
	{
		"id": "RECORD0002",
		"data": {
			"BodyText": "This is more sample body text",
			"ModifyDate": "2018/01/08",
			"Tags": "bug, closed"
		}
	}
];

let job_id = unbase.bulkInsert( 'myapp', records, function(err) {
	if (err) throw err;
} );
```

The callback is optional.  You can omit it, and instead track job progress by polling [getStats()](#getstats).  The method returns an alphanumeric Job ID.

## bulkUpdate

```js
unbase.bulkUpdate( INDEX_ID, RECORDS, UPDATES [CALLBACK] );
```

The `bulkDelete()` method allows you to update a large number of records all at once.  You need to provide an array of record IDs, and a sparse object containing the updates to apply.  The same updates are applied to all the records.  Example:

```js
let records = [ 
	"RECORD0001", 
	"RECORD0002" 
];
let updates = {
	"Tags": "bug, closed"
};

let job_id = unbase.bulkUpdate( 'myapp', records, updates, function(err) {
	if (err) throw err;
} );
```

The callback is optional.  You can omit it, and instead track job progress by polling [getStats()](#getstats).  The method returns an alphanumeric Job ID.

## bulkDelete

```js
unbase.bulkDelete( INDEX_ID, RECORDS, [CALLBACK] );
```

The `bulkDelete()` method allows you to delete a large number of records all at once.  You only need to provide an array of record IDs.  Example:

```js
let records = [ 
	"RECORD0001", 
	"RECORD0002" 
];

let job_id = unbase.bulkDelete( 'myapp', records, function(err) {
	if (err) throw err;
} );
```

The callback is optional.  You can omit it, and instead track job progress by polling [getStats()](#getstats).  The method returns an alphanumeric Job ID.

## search

```js
unbase.search( INDEX_ID, QUERY, OPTIONS, CALLBACK );
```

The `search()` method performs an index search, and returns the matching records, optionally sorted and paginated (offset / limit).  You need to provide the index ID, and a search query (either in [simple](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#simple-queries) or [PxQL](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#pxql-queries) format), some options like `offset` and `limit`, and a callback.  Here is a list of all the supported options:

| Property | Type | Description |
|----------|------|-------------|
| `offset` | Number | For paginating results, this specifies the offset into the record set (defaults to `0`). |
| `limit` | Number | For paginating results, this specifies the number of records to load for the page (defaults to all). |
| `sort_by` | String | Specifies which [sorter](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#sorting-results) to sort the results by, defaults to sorting by record ID. |
| `sort_dir` | -1 | Specifies which sort direction, `1` for ascending (default), or `-1` for descending. |
| `sort_type` | String | If `sort_by` is omitted, records will be sorted by their IDs.  In that case you can set `sort_type` to `string` to treat the IDs as strings (default), or `number` to treat them as numbers.  This can affect the sort order. |

Example search:

```js
unbase.search( 'myapp', 'tags:open', { offset: 0, limit: 10 }, function(err, data) {
	if (err) throw err;
	// data.records is a sorted array of records in our offset/limit
	// data.total is the total number of records matched (ignoring our limit)
	// data.perf is a performance tracker (pixl-perf) containing query metrics
} );
```

This would find all records that have `open` in their `tags` field, and return the first 10 records at offset 0.  By default the records are sorted by their IDs (ascending).  However, you can provide your own sorting options:

```js
let opts = { 
	offset: 0, 
	limit: 10,
	sort_by: "created",
	sort_dir: -1
};

unbase.search( 'myapp', 'tags:open', opts, function(err, data) {
	if (err) throw err;
	// data.records is a sorted array of records in our offset/limit
	// data.total is the total number of records matched (ignoring our limit)
	// data.perf is a performance tracker (pixl-perf) containing query metrics
} );
```

This would perform the same search as the above example, but this time it will sort the records using the `created` sorter field (see [Sorting Results](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#sorting-results)), and sort in reverse (descending) order.

## subscribe

```js
unbase.subscribe( INDEX_ID, QUERY, OPTIONS );
```

The `subscribe()` method sets up a live search connection.  It returns a special [Subscriber](#subscriber) object, which you can attach event listeners to.  The subscriber will be notified every time the search results change.  The method arguments are largely the same as [search()](#search), except for the callback, which is omitted.  Example:

```js
let sub = unbase.subscribe( 'myapp', 'tags:open', { offset: 0, limit: 10 } );

sub.on('change', function(data) {
	// our search results have changed
	// data.records is a sorted array of records in our offset/limit
	// data.total is the total number of records matched (ignoring our limit)
});
```

The [change](#event-change) event is fired every time your search results change, including immediately after subscribing (for the initial result set).  See the [Subscriber](#subscriber) section below for more.

In addition to subscribing to record searches, you can also subscribe to field summaries.  See [Live Summaries](#live-summaries) for details.

## getStats

```js
unbase.getStats();
```

The `getStats()` method returns performance and job statistics data.  You can poll this method to display status on background jobs, and other internal storage metrics.  Example:

```js
let stats = unbase.getStats();
```

For details on the contents of the stats object, see [Performance Metrics](https://github.com/jhuckaby/pixl-server-storage#performance-metrics) and [Jobs](#jobs).

## Subscriber

A special subscriber object is returned from the [subscribe()](#subscribe) method.  This represents a single "connection" to a specific live search, and will be notified by event when the search results change.  It has the following events and methods:

### Event: change

The `change` event is fired every time the search results change.  The engine is smart enough to only fire a change event if your result set is affected.  Example use:

```js
sub.on('change', function(data) {
	// our search results have changed
	// data.records is a sorted array of records in our offset/limit
	// data.total is the total number of records matched (ignoring our limit)
});
```

### Event: error

The `error` event is fired upon search error.  The [subscribe()](#subscribe) method will throw if an immediate error is encountered, as in a syntax error in the search query, but asynchronous background errors are also possible.  Those are emitted via `error` events.  Example:

```js
sub.on('error', function(err) {
	console.error("Live search error: " + err);
});
```

### Event: destroy

The `destroy` event is fired when the live search must be shut down, and the connection to the subscriber severed.  This can happen if the underlying index is fundamentally changed (i.e. field removed, index deleted, etc.).  Example:

```js
sub.on('destroy', function() {
	// shut down client connection, if any
});
```

Clients should either display an error when this happens, and/or try to resubscribe to the search.  However, resubscribing may also fail, for example if the search included a field that was removed.  Make sure your client app is designed to handle this situation.

### Method: changeOptions

The `changeOptions()` method allows the subscriber to change the `offset` and/or `limit` properties of the live search, essentially proving a way to page through results without having to re-subscribe.  This is *much* faster than issuing a separate search for each page offset.  Example use:

```js
sub.changeOptions({
	offset: 20,
	limit: 10
});
```

Note that you cannot change the [sorter](https://github.com/jhuckaby/pixl-server-storage/blob/master/docs/Indexer.md#sorting-results) or sort direction using this method.  Any sort change requires an unsubscribe / resubscribe.

### Method: unsubscribe

The `unsubscribe()` method disconnects the client from the the live search.  Your client app needs to make sure to track all subscriptions and call this method when they are done with searches.  It takes no arguments and has no return value.  Example:

```js
sub.unsubscribe();
```

# Logging

See [Logging](https://github.com/jhuckaby/pixl-server-storage/blob/master/README.md#logging).

# License

**The MIT License (MIT)**

Copyright (c) 2018 - 2022 Joseph Huckaby.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
