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

// Helper: Determine if an error should just be logged.
function triageError(err) {
    if (err && err.name == 'ProjectMill') {
        console.warn(err.toString());
        err = null;
    }
    return err;
}

// Helper: Recursive version or fs.readdir
function readdirr(dir, callback, dotfiles) {
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
                // Skip dotfiles
                if (f[0] == '.' && !dotfiles) return done();

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

// Helper: Recursive file deletion
function recursiveDelete(delPath, callback) {
    readdirr(delPath, function(err, files) {
        var tree = [],
            dirs = {};

        files.forEach(function(f) {
            f = (typeof f == 'object' ? f.target : f);
            f = path.join(delPath, f);
            if (dirs[path.dirname(f)] == undefined) {
                dirs[path.dirname(f)] = f;
                tree.push(path.dirname(f));
            }
            tree.push(f);
        });

        var steps = [];
        tree.reverse().forEach(function(p) {
            if (dirs[p] == undefined) {
                steps.push(function(next, err) {
                    if (err) return next(err);
                    fs.unlink(p, next);
                });
            }
            else {
                steps.push(function(next, err) {
                    if (err) return next(err);
                    fs.rmdir(p, next);
                });
            }
        });
        serial(steps, callback);
    }, true);
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

// Helper: Process a file.
function fileprocess(source, dest, processor, callback) {
    fs.readFile(source, 'utf8', function(err, data){
        data = processor(data);
        fs.writeFile(dest, data, 'utf8', callback);
    });
}

// Processor: MML
function processMML(config) {

    // add 'b' to 'a'
    function assign(a, b, k) {
        switch (typeof b[k]) {
            case 'object':
                iterObject(a[k], b[k]);
                break;
            case 'array':
                iterArray(a[k], b[k]);
                break;
            case 'number':
            case 'string':
            case 'boolean':
                a[k] = b[k];
                break;
        }
    }

    function iterObject(a, b) {
        for (var k in b) {
            assign(a, b, k);
        }
    }

    function iterArray(a, b) {
        b.forEach(function(v, i) {
            assign(a, b, i);
        });
    }

    return function(o) {
        o = JSON.parse(o);
        iterObject(o, config.mml);
        return JSON.stringify(o, null, 2);
    }
}

// Processor: MSS
function processMSS(config) {
    var varMatch = /^@([\w-]+):[\W]?([^;]+);$/;

    return function(o) {
        var lines = o.split("\n");
        for (var i = 0; i < lines.length; i++) {
            lines[i] = lines[i].replace(varMatch, function(m, n, v, o, s) {
                if (config.cartoVars[n] != undefined) {
                    return '@' + n +': '+ config.cartoVars[n] +';';
                }
                return s;
            });
        }
        return lines.join("\n");
    }
}

var usage = 'Usage: ./index.js <command> [-c ./config.json] [-t /path/to/tilemill]';

// Closure vars
var config = {},
    tilemill = '',
    argv = require('optimist').usage(usage).argv,
    fileDir = argv.p || path.join(process.env.HOME, 'Documents', 'MapBox'),
    command = argv._.pop();

// If no command was issued bail. Perhaps we should have a default?
if (command != 'mill' && command != 'render' && command != 'upload') {
    console.warn('Error: invalid or missing command');
    console.warn(usage);
    process.exit(1);
}

// Try to locate TileMill
var tilemillPath = argv.t || 'tilemill';
try {
    var tilemill = require.resolve(tilemillPath);
}
catch(err) {
    console.warn('Error: could not locate TileMill');
    console.warn(usage);
    process.exit(1);
}

// Assemble the main actions.
var actions = [],
    cli = require('readline').createInterface(process.stdin, process.stdout);

// Get our configuration
actions.push(function(next, err) {
    if (err) return next(err);

    var configFile = argv.c || 'config.json';
    fs.readFile(path.join(process.cwd(), configFile), 'utf8', next);
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
            config[i].destination = path.join(fileDir, 'project', config[i].destination);
        }
    }
    next();
});

// Regardless of the command 'mill' needs to run.
actions.push(function(next, err) {
    if (err) return next(err);

    var mill = [];
    Object.keys(config).forEach(function(i) {

        mill.push(function(cb, err) {
            err = triageError(err);
            if (err) return cb(err);

            path.exists(config[i].destination, cb);
        });
        mill.push(function(cb, exists) {
            if (!exists) return cb();

            cli.question('Project '+ i +' already exists. Re-mill? (y/N): ', function(r){
                if (r.toLowerCase() === "y") {
                    console.warn('Notice: removing project '+ config[i].destination);
                    recursiveDelete(config[i].destination, cb);
                }
                else {
                    var e = new Error('Skipping project '+ i);
                    e.name = "ProjectMill";
                    cb(e);
                }
            });
        });
        mill.push(function(cb, err) {
            if (err) return cb(err);

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

                // In the future the 'mml' file will always be called
                // 'project.mml', but currently this isn't the case.
                // TODO delete this when https://github.com/mapbox/tilemill/pull/970
                //      is merged.
                if (path.extname(filename) == '.mml' && filename != 'project.mml') {
                    destfile = path.join(config[i].destination, i +'.mml');
                }

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
                        return fs.symlink(linkSource, destfile, next);
                    }
                    else if (config[i].mml && path.extname(filename) == '.mml') {
                        console.log('Notice: processing mml file: ' + sourcefile +' to '+ destfile);
                        return fileprocess(sourcefile, destfile, processMML(config[i]), next);
                    }
                    else if (config[i].cartoVars && path.extname(filename) == '.mss') {
                        console.log('Notice: processing carto file: ' + sourcefile +' to '+ destfile);
                        return fileprocess(sourcefile, destfile, processMSS(config[i]), next);
                    }
                    else {
                        console.log('Notice: coping file: ' + sourcefile +' to '+ destfile);
                        return filecopy(sourcefile, destfile, next)
                    }
                });
            })
            serial(setup, function(err) {
                if (err) console.warn(err);
                cb();
            });
        });
    });
    serial(mill, function(err) {
        next(triageError(err));
    });
});

// If trying to render, or upload, do it now!
if (command == "render" || command == "upload") {
    var spawn = require('child_process').spawn,
        sqlite3 = require('sqlite3');

    actions.push(function(next, err) {
        if (err) return next(err);

        var render = [];
        Object.keys(config).forEach(function(i) {
            var data = config[i],
                destfile = path.join(fileDir, 'export', i + '.' + data.format);

            render.push(function(cb, err) {
                err = triageError(err);
                if (err) return cb(err);

                path.exists(destfile, cb);
            });
            render.push(function(cb, exists) {
                if (!exists) return cb();

                cli.question('Overwrite '+ destfile +'? (y/N): ', function(r) {
                    if (r.toLowerCase() === "y") {
                        console.log("Notice: deleting " + destfile);
                        fs.unlink(destfile, cb);
                    }
                    else {
                        var e = new Error('Skipping export');
                        e.name = "ProjectMill";
                        cb(e);
                    }
                });
            });
            render.push(function(cb, err) {
                if (err) return cb(err);

                if (data.format == undefined) {
                    var err = new Error('export format not specified for `'+i+'`');
                    return cb(err);
                }

                var args = [];
                // nice the export process.
                args.push('-n19');
                // node command
                args.push(process.execPath);
                // tilemill index.js
                args.push(path.join(tilemill));
                // export command
                args.push('export');
                // datasource
                args.push(i);
                // filepath
                args.push(destfile);
                // format, don't try to guess extension based on filepath
                args.push('--format=' + data.format);

                if (data.bbox) args.push('--bbox=' + data.bbox.join(','));
                if (data.width) args.push('--width=' + data.width);
                if (data.height) args.push('--height=' + data.height);
                if (data.minzoom) args.push('--minzoom=' + data.minzoom);
                if (data.maxzoom) args.push('--maxzoom=' + data.maxzoom);

                console.log('Notice: nice ' + args.join(' '));

                // todo get more output from the child process.
                // todo get the actual name of the database written to.
                spawn('nice', args).on('exit', function(code, signal) {
                    var err = code ? new Error('Render failed: '+ i) : null;
                    cb(err);
                });
            });

            // If this isn't mbtile, or we don't have meta data to add to it
            // skip the remainder of the render steps.
            if (data.format != 'mbtiles' || data.MBmeta == undefined) return;

            render.push(function(cb, err) {
                if (err) return cb(err);

                var db = new sqlite3.Database(destfile, sqlite3.OPEN_READWRITE, function(err) {
                    cb(err, db);
                });
            });
            render.push(function(cb, err, db) {
                if (err) return cb(err);

                var rows = [];
                Object.keys(data.MBmeta).forEach(function(k) {
                    if (typeof data.MBmeta[k] != 'string') return;

                    rows.push(function(nextRow, err) {
                        if (err) return console.warn(err.toString());

                        var sql = 'REPLACE INTO metadata (name, value) VALUES (?, ?)';
                        var stmt = db.prepare(sql, function(err) {
                            nextRow(err, stmt);
                        });
                    });
                    rows.push(function(nextRow, err, stmt) {
                        if (err) return nextRow(err);

                        console.log('Notice: writing custom metadata: '+ k +' -> '+ data.MBmeta[k]);
                        stmt.run(k, data.MBmeta[k], function(err){
                            if (err) console.warn(err);
                            stmt.finalize(nextRow);
                        })
                    });
                });
                serial(rows, function(err) {
                    delete db;
                    cb(err, db);
                });
            });
        });
        serial(render, function(err) {
            next(triageError(err));
        });
    });
}

// Uploading... yea...
if (command == "upload") {
    actions.push(function(next, err) {
        if (err) return next(err);

        console.warn('Sorry, I cannot upload yet.')
        next();
    });
}

// Run the main actions.
serial(actions, function(err) {
    if (err) console.warn(err.toString());
    console.log('Done.');

    // Interface cleanup
    cli.close();
    process.stdin.destroy();
});
