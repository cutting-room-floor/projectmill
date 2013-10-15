/**
 * Filesystem utilities for node.js
 *
 * All are async style, most provide recursive versions of node's built in
 * filesystem utilities.
 */
var fs = require('fs');
var path = require('path');
var util = require('util');
var serial = require('./serial');
var exists = require('fs').exists || require('path').exists;

// Helper: Recursive version of fs.readdir
function readdirr(dir, callback, dotfiles) {
    var filelist = [],
        dirlist = [],
        wait = 1;

    var done = function(err) {
        if (err) console.warn(err.message);

        wait--;
        if (wait === 0) callback(null, filelist, dirlist);
    };

    (function read(d, basepath) {
        basepath = basepath || '';
        fs.readdir(path.join(d, basepath), function(err, files) {
            if (err) return callback(err);

            basepath && dirlist.push(basepath);
            if (!files.length) {
                return done();
            }

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

                            filelist.push(f);
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
    readdirr(delPath, function(err, files, directories) {
        var steps = [];
        files.forEach(function(f) {
            steps.push(function(next, err) {
                if (err) return next(err);
                fs.unlink(path.join(delPath, f), next);
            });
        });
        directories.reverse().forEach(function(d) {
            steps.push(function(next, err) {
                if (err) return next(err);
                fs.rmdir(path.join(delPath, d), next);
            });
        });
        steps.push(function(next, err) {
            if (err) return next(err);
            fs.rmdir(delPath, next);
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
    exists(p, function(found) {
        if (found) return cb(null);
        mkdirp(ps.slice(0, -1).join('/'), mode, function(err) {
            if (err && err.errno != constants.EEXIST) return cb(err);
            fs.mkdir(p, mode, cb);
        });
    });
};

// Helper: Copy a file
function filecopy(source, dest, callback) {
    var newFile = fs.createWriteStream(dest);
    newFile.once('open', function(fd) {
        var oldFile = fs.createReadStream(source);
        oldFile.once('open', function(fd) {
            util.pump(oldFile, newFile, function(err) {
                if (err) console.warn(err);
                callback(err);
            });
        });
    });
}

module.exports = {
    readdirr: readdirr,
    recursiveDelete: recursiveDelete,
    mkdirp: mkdirp,
    filecopy: filecopy
};
