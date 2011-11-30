#!/usr/bin/env node

var fs = require('fs'),
    path = require('path');

// Helper: Run an array of functions in serial
function serial(steps, done) {
    // From underscore.js
    var wrap = function(func, wrapper) {
        return function() {
          var args = [func].concat(Array.prototype.slice.call(arguments));
          return wrapper.apply(this, args);
        };
    };
    // And run!
    (steps.reduceRight(wrap, done))();
}

// Helper: Recursive version or fs.readdir
function readdirr(dir, callback) {
    var filelist = [],
        wait = 1;

    var done = function() {
        wait--;
        if (wait === 0) callback(null, filelist);
    };

    (function read(d) {
        fs.readdir(d, function(err, files) {
            if (err) return callback(err);

            wait--; // Don't wait on the directory...
            wait += files.length; // ...wait on it's files.

            files.forEach(function(f) {
                f = path.join(d, f)
                fs.stat(f, function(err, stats) {
                    if (err) {
                        console.warn(err.message);
                        return done();
                    }
                    if (stats.isFile()) {
                        filelist.push(f);
                        return done();
                    }
                    if (stats.isDirectory()) {
                        return read(f);
                    }
                });  
            });
        });
    })(dir);
}

var usage = 'Usage: ./index.js <command> [-c ...] [-p ...]';

// Closure vars
var config = {},
    tilemill = '',
    argv = require('optimist').usage(usage).argv,
    fileDir = argv.d || path.join(process.env.HOME, 'Documents', 'MapBox'),
    command = argv._.pop();

// If no command was issued bail. Perhaps we should have a default?
if (command != 'mill' && command != 'render' && command != 'upload') {
    console.warn('Error: invalid or missing command');
    console.warn(usage);
    process.exit(1);
}

// Try to locate TileMill
var tilemillPath = argv.p || 'tilemill';
try {
    var tilemill = require.resolve(tilemillPath);
}
catch(err) {
    console.warn('Error: could not locate TileMill');
    console.warn(usage);
    process.exit(1);
}

// Assemble the main actions.
var actions = [];

// Get our configuration
actions.push(function(next, err) {
    if (err) return next(err);

    var configFile = argv.c || 'config.json';
    fs.readFile(path.join(process.cwd(), 'config.json'), 'utf8', next);
});
actions.push(function(next, err, data) {
    if (err) return next(err);

    try {
        data = JSON.parse(data);
    }
    catch(err) {
        return next(err);
    }

    data.forEach(function(v) {
        // TODO check for other required elements.
        if (v.source && v.destination) {
            config[v.destination] = v;
        }
        else {
            console.warn("Error: skipping project definition >> " + JSON.stringify(v));
        }
    });
    next();
});

// Prepare Configuration
actions.push(function(next, err) {
    if (err) return next(err);

    var projectDir = path.join(fileDir, 'project');
    fs.readdir(projectDir, next);
});
actions.push(function(next, err, files) {
    if (err) return next(err);

    var paths = {};
    files.forEach(function(v) {
        if (v[0] == '.') return;
        paths[v] = path.join(fileDir, 'project', v);
    });

    for (var i in config) {
        if (paths[config[i].source] == undefined) {
            console.warn("Error: skipping project definition >> " + JSON.stringify(config[i]));
            delete config[i];
        }
        else {
            config[i].source = paths[config[i].source];
            if (paths[config[i].destination]) {
                console.warn('Error: destination map '+ config[i].destination +' already exists');
                delete config[i];
            }
            else {
                config[i].destination = path.join(fileDir, 'project', config[i].destination);
            }
        }
    }
    next();
});

actions.push(function(next, err) {
    // Regardless of the command 'mill' needs to run.
    var mill = [];
    for (var i in config) {
        mill.push(function(cb) {
            readdirr(config[i].source, cb);
        });
        mill.push(function(cb, err, files) {
            if (err) return cb(err);
            console.log(files);
            cb();
        });
    }
    serial(mill, next);
});

// Run the main actions.
serial(actions, function(err) {
    if (err) console.warn(err.message);
    console.log('done.');
});
