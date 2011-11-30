#!/usr/bin/env node

var fs = require('fs'),
    path = require('path'),
    util = require('util');

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

    var done = function(err) {
        if (err) console.warn(err.message);

        wait--;
        if (wait === 0) callback(null, filelist);
    };

    (function read(d, basepath) {
        fs.readdir(path.join(d, basepath), function(err, files) {
            if (err) return callback(err);

            wait--; // Don't wait on the directory...
            wait += files.length; // ...wait on it's files.

            files.forEach(function(f) {
                f = path.join(basepath, f);
                var filepath = path.join(d, f)

                fs.lstat(filepath, function(err, stats) {
                    if (err) return done(err);

                    if (stats.isDirectory()) {
                        return read(dir, f);
                    }
                    else if (stats.isFile()) {
                        filelist.push(f);
                        return done();
                    }
                    else if (stats.isSymbolicLink()) {
                        fs.readlink(filepath, function(err, src) {
                            if (err) return done(err);

                            filelist.push({source: src, target: f});
                            return done();
                        });
                    }
                });  
            });
        });
    })(dir);
}

// Helper: Recursive version or fs.mkdir
// https://gist.github.com/707661
function mkdirp(p, mode, f) {
    var cb = f || function() {};
    if (p.charAt(0) != '/') {
        cb(new Error('Relative path: ' + p));
        return;
    }

    var ps = path.normalize(p).split('/');
    path.exists(p, function(exists) {
        if (exists) return cb(null);
        mkdirp(ps.slice(0, -1).join('/'), mode, function(err) {
            if (err && err.errno != constants.EEXIST) return cb(err);
            fs.mkdir(p, mode, cb);
        });
    });
};

// Helper: Copy a file
function filecopy(source, dest, callback) {
    newFile = fs.createWriteStream(dest);
    oldFile = fs.createReadStream(source);

    newFile.once('open', function(fd){
        util.pump(oldFile, newFile, callback);
    });
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
            console.warn("Error: project missing required elements >> " + JSON.stringify(v));
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
            console.warn("Error: source project doesn't exist >> " + JSON.stringify(config[i]));
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

// Regardless of the command 'mill' needs to run.
actions.push(function(next, err) {
    var mill = [];
    for (var i in config) {
        mill.push(function(cb, exists) {
            readdirr(config[i].source, cb);
        });
        mill.push(function(cb, err, files) {
            if (err) return cb(err);

            var setup = [];
            files.forEach(function(filename) {
                // Handle symlinks which come in as an object.
                var linkSource = '';
                if (typeof filename != 'string') {
                     linkSource = filename.source;
                     filename = filename.target
                }

                var destfile = path.join(config[i].destination, filename),
                    destdir = path.dirname(destfile),
                    sourcefile = path.join(config[i].source, filename);

                setup.push(function(next) {
                    path.exists(destdir, next);
                });
                setup.push(function(next, err, exists) {
                    if (exists) next();

                    console.log('Notice: creating directory: ' + destdir);
                    mkdirp(destdir, '0777', next);
                });
                setup.push(function(next, err) {
                    if (err) next(err);

                    if (linkSource) {
                        console.log('Notice: creating symlink: ' + destfile + ' -> ' + linkSource);
                        fs.symlink(linkSource, destfile, next);
                    }
                    else {
                        console.log('Notice: coping file: ' + sourcefile +' to '+ destfile);
                        filecopy(sourcefile, destfile, next)
                    }
                });
            })
            serial(setup, function(err) {
                if (err) console.warn(err.message);
                cb();
            });
        });
    }
    serial(mill, next);
});

// Run the main actions.
serial(actions, function(err) {
    if (err) console.warn(err.message);
    console.log('done.');
});
