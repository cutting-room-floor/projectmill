#!/usr/bin/env node

var fs = require('fs'),
    path = require('path'),
    utils = require('./lib/utils'),
    serial = require('./lib/serial');

// Helper: Determine if an error should just be logged.
function triageError(err) {
    if (err && err.name == 'ProjectMill') {
        console.warn(err.toString());
        err = null;
    }
    return err;
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
    replaceExisting = argv.f || false;

// If no command was issued bail.
if (!argv.mill && !argv.optimize && !argv.render && !argv.upload) {
    console.warn('Error: missing command. Available commands are `--mill`, '+
        '`--optimize`, `--render`, `--upload`');
    console.warn(usage);
    process.exit(1);
}

// Try to locate TileMill
var tilemillPath = argv.t;
if (!tilemillPath && require('os').type() == 'Darwin') {
    tilemillPath = '/Applications/TileMill.app/Contents/Resources';
}
else if (!tilemillPath) {
    tilemillPath = '/usr/share/tilemill';
}

try {
    tilemillPath = require.resolve(tilemillPath);
    if (!argv.t) {
        console.warn("Notice: using TileMill from '"+ tilemillPath +"'");
    }
}
catch(err) {
    console.warn("Error: could not locate TileMill. Looking in '"+ tilemillPath +"'");
    console.warn(usage);
    process.exit(1);
}

// Assemble the main actions.
var actions = [];

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
            v.source = path.join(fileDir, 'project', v.source);
            v.destination = path.join(fileDir, 'project', v.destination);
        }
        else {
            console.warn("Error: project missing required elements >> " + JSON.stringify(v));
        }
    });
    next();
});

// Mill projects defined in configuration.
if (argv.mill) {

    // Validate source paths.
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
            paths[path.join(fileDir, 'project', v)] = path.join(fileDir, 'project', v);
        });
        for (var i in config) {
            if (paths[config[i].source] == undefined) {
                console.warn("Error: source project doesn't exist >> " + JSON.stringify(config[i]));
                delete config[i];
            }
        }
        next();
    });

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

                if (replaceExisting) {
                    console.log('Notice: removing project '+ config[i].destination);
                    utils.recursiveDelete(config[i].destination, cb);
                }
                else {
                    var e = new Error('Skipping project '+ i);
                    e.name = "ProjectMill";
                    cb(e);
                }
            });
            mill.push(function(cb, err) {
                if (err) return cb(err);

                utils.readdirr(config[i].source, cb);
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
                        if (exists) return next();

                        utils.mkdirp(destdir, '0777', next);
                    });
                    setup.push(function(next, err) {
                        if (err) next(err);

                        if (linkSource) {
                            return fs.symlink(linkSource, destfile, next);
                        }
                        else if (config[i].mml && path.extname(filename) == '.mml') {
                            return fileprocess(sourcefile, destfile, processMML(config[i]), next);
                        }
                        else if (config[i].cartoVars && path.extname(filename) == '.mss') {
                            return fileprocess(sourcefile, destfile, processMSS(config[i]), next);
                        }
                        else {
                            return utils.filecopy(sourcefile, destfile, next);
                        }
                    });
                })
                serial(setup, function(err) {
                    if (err) console.warn(err);
                    cb();
                });
            });
            mill.push(function(cb, err) {
                if (!err) console.log('Notice: created project '+ config[i].destination);
                cb(err);
            });
        });
        serial(mill, function(err) {
            next(triageError(err));
        });
    });
}

// Optimize SQLite datasources
if (argv.optimize) {
    // Get locations of all MML files.
    actions.push(function(next, err) {
        var optimize = [],
            mml = {};

        Object.keys(config).forEach(function(i) {
            optimize.push(function(cb, err) {
                utils.readdirr(config[i].destination, cb);
            });

            optimize.push(function(cb, err, files) {
                if (err) return cb(err);

                files.forEach(function(filename) {
                    if (path.extname(filename) == '.mml') {
                        mml[i] = [config[i].destination, filename];
                    }
                });
                cb();
            });
        });

        serial(optimize, function(err) { next(err, mml) });
    });

    // Extract all source definitions which we can optimize.
    actions.push(function(next, err, mml) {
        if (err) next(err);

        var optimize = [],
            sources = [];
        Object.keys(mml).forEach(function(f) {
            var filename = path.join.apply(null, mml[f]);
            optimize.push(function(cb, err) {
                fs.readFile(filename, 'utf8', cb);
            });

            optimize.push(function(cb, err, data) {
                if (err) next(err);

                var data = JSON.parse(data);

                data.Layer.forEach(function(layer, i) {
                    if (layer.Datasource.type == 'sqlite' &&
                        layer.Datasource.table.indexOf(' ') !== -1)
                    { 
                        sources.push({
                            project: mml[f],
                            index: i,
                            datasource: layer.Datasource
                        });
                    }
                });
                cb();
            });
        });

        serial(optimize, function(err) { next(err, sources); });
    });

    // TODO create new dbs, insert data, update mml files...
    actions.push(function(next, err, sources) {
        var sqlite3 = require('sqlite3');

        var tableDef = function(row) {
            var cols = [];
            Object.keys(row).forEach(function(k) {
                var type = typeof row[k];

                if (type == 'number') {
                    cols.push("'"+k+"' FLOAT");
                }
                else if (type == 'string') {
                    cols.push("'"+k+"' VARCHAR");
                }
                else {
                    cols.push("'"+k+"' BLOB");
                }
            });
            return cols;
        };

        var colNames = function(row) {
            var cols = []
            Object.keys(row).forEach(function(k) {
                cols.push(k);
            });
            return cols;
        };

        var rowVals = function(cols, row) {
            var vals = [];
            cols.forEach(function(k) {
                vals.push(row[k]);
            });
            return vals;
        }

        var optimize = [];
        sources.forEach(function(s) {
            // Open the source database.
            optimize.push(function(cb, err) {
                if (err) return next(err);

                // Make all paths absolute.
                if (s.datasource.file[0] !== '/') {
                    s.datasource.file = path.normalize(path.join(s.project[0], s.datasource.file));
                }
                s.dbSource = new sqlite3.Database(s.datasource.file, sqlite3.OPEN_READONLY, cb);
            });


            if (s.datasource.attachdb) {
                optimize.push(function(cb, err) {
                    if (err) return next(err);
                    //s.dbSource.run('ATTACH DATABASE foo as BAR');
                    console.log('ATTACH NOT IMPLEMENTED');
                    process.exit(1);
                });
            }

            // Create and open the target database.
            optimize.push(function(cb, err) {
                if (err) return next(err);

                s.targetFile = path.join('layers', 'materialized-' + path.basename(s.datasource.file));

                var target = path.join(s.project[0], s.targetFile);
                s.dbTarget = new sqlite3.Database(target, cb);
            });

            optimize.push(function(cb, err) {
                if (err) return next(err);
                var tablename = path.basename(s.datasource.file, '.sqlite');
                var first = true;

                var select = 'SELECT * FROM '+ s.datasource.table;
                s.dbSource.each(select, function(err, row) {
                    var insert = function() {
                        var cols = colNames(row),
                            vals = rowVals(cols, row);

                        var params = [];
                        cols.forEach(function() {
                            params.push('?');
                        });
                        params = params.join(', ');

                        var sql = 'INSERT into '+ tablename;
                        sql += ' (\'' + cols.join("', '") +'\')';
                        sql += ' VALUES ('+ params  +')';

                        s.dbTarget.run(sql, vals);
                    };

                    if (first) {
                        // On the first result we need to create the table and
                        // then insert.
                        first = false;
                        var sql = 'CREATE TABLE '+ tablename;
                        sql += ' ('+ tableDef(row).join(", ") +')'

                        s.dbTarget.exec(sql, function(err) {
                            if (err) return next(err);
                            insert();
                        });
                    }
                    else {
                        // For subsequent ones we just insert data;
                        insert();
                    }

                }, cb);
            });

            // TODO copy geometry_columns & spatial_ref_sys tables

        });

        serial(optimize, function(err) { next(err); });

    });
}

// Render all available projects.
if (argv.render) {
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

                if (replaceExisting) {
                    console.log("Notice: deleting " + destfile);
                    fs.unlink(destfile, cb);
                }
                else {
                    var e = new Error('Skipping export ' + i);
                    e.name = "ProjectMill";
                    cb(e);
                }
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
                args.push(tilemillPath);
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
                if (data.maxzoom) args.push('--files=' + fileDir);

                console.log('Notice: spawning nice ' + args.join(' '));

                // todo get the actual name of the database written to.
                var nice = spawn('nice', args);
                nice.stdout.on('data', function(data) {
                    console.log(data.toString());
                });
                nice.stderr.on('data',  function(data) {
                    console.warn(data.toString());
                });
                nice.on('exit', function(code, signal) {
                    var err = null;
                    if (code) {
                        err = new Error('Render failed: '+ i);
                        err.name = 'ProjectMill';
                    }
                    else {
                        console.log('Notice: rendered ' + destfile);
                    }
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
            render.push(function(cb, err) {
                if (!err) console.log('Notice: added metadata to ' + destfile);
                cb(err);
            });
        });
        serial(render, function(err) {
            next(triageError(err));
        });
    });
}

// Upload available mbtiles files.
if (argv.upload) {
    var spawn = require('child_process').spawn;
    actions.push(function(next, err) {
        if (err) return next(err);

        var upload = [];
        Object.keys(config).forEach(function(i) {
            var data = config[i];
            if (data.syncAccount && data.syncAccessToken) {
                upload.push(function(cb, err) {
                    err = triageError(err);
                    if (err) return next(err);

                    // todo - mbtilesFile name is guess work.
                    var args = [],
                        mbtilesFile = path.join(fileDir, 'export', i + '.mbtiles');

                    // tilemill index.js
                    args.push(tilemillPath);
                    // export command
                    args.push('export');
                    // datasource
                    args.push(i);
                    // file
                    args.push(mbtilesFile);
                    // signal upload
                    args.push('--format=upload');
                    // OAuth config.
                    args.push('--syncAccount=' + data.syncAccount);
                    args.push('--syncAccessToken=' + data.syncAccessToken);

                    // todo get more output from the child process.
                    var retries = 0;
                    var upload = function(callback) {
                        var retry = false;
                        console.log('Notice: spawning ' + process.execPath + ' ' + args.join(' '));
                        var tilemill = spawn(process.execPath, args);
                        tilemill.stdout.on('data', function(data) {
                            console.log(data.toString());
                        });
                        tilemill.stderr.on('data', function(data) {
                            var error = data.toString();
                            console.warn(error);
                            retry = error.match(/.*S3 is not available.*/) && (++retries < 4);
                        });
                        tilemill.on('exit', function(code, signal) {
                            var err = null;
                            if (code && retry) {
                                console.log('Retrying upload in ' + retries + ' second(s) (attempt ' + retries + ')');
                                return setTimeout(function() {
                                    upload(callback);
                                }, 1000 * retries);
                            }
                            if (code) {
                                err = new Error('Upload failed: '+ i);
                                err.name = 'ProjectMill';
                            }
                            else {
                                console.log('Notice: uploaded ' + mbtilesFile + ' to ' + data.syncAccount);
                            }
                            callback(err);
                        });
                    }
                    upload(cb);
                });
            }
        });
        serial(upload, function(err) {
            next(triageError(err));
        });
    });
}

// Run the main actions.
serial(actions, function(err) {
    if (err) console.warn(err.toString());
    console.log('Done.');
});
