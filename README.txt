ProjectMill
-----------

Need to generate a bunch of TileMill projects that are nearly identical and
then render them all out? What to script that? We gotcha covered.

## Depends

 - Node.js v0.8.x or v0.10.x

## Installation

ProjectMill is a node.js script that is run from the command line. To install:

    git clone https://github.com/mapbox/projectmill.git
    cd projectmill
    npm install

## Usage

Usage: `./index.js <command> [options]`

Example: `./index.js --mill --render -c config.example.json -t ../tilemill/`

Note: the `-t` option can either point to a source checkout and built version of TileMill
or it can point to a packaged version of TileMill. 

On Ubuntu it can point to the apt-get installed location of TileMill:

    -t /usr/share/tilemill/

On OS X the `TileMill.app` bundles its own node.js version so you first need to set your PATH

    export PATH=/Applications/TileMill.app/Contents/Resources/:$PATH

Then you can pass the `-t` argument to point inside the TileMill.app:

    -t /Applications/TileMill.app/Contents/Resources/


## Configuration

Configuration is expected as a json file which contains an array as the root
object. See `config.example.json` for an example. Each element in the array
should be an object which can have the following keys:

`source`        REQUIRED The source project, generally the name of folder it
                lives in.

`destination`   REQUIRED The destination project name.

`mml`           A json snippet which will be merged on top of the project's mml
                file. To clear out an option set it to 'null'

`cartoVars`     A json object containing key value pairs which can be use to
                override variables in in carto stylesheets.

`MBmeta`        MBTiles: A json object containing key value pairs which will be added to
                a rendered MBtiles export.

Additionally, the following options will be passed to TileMill's export commnd

`format`        Export format (png|pdf|svg|mbtiles). (Default: undefined)

`bbox`          Array containing coordinates of bounding box to export. (Default: undefined)

`minzoom`       MBTiles: minimum zoom level to export. (Default: undefined)

`maxzoom`       MBTiles: maximum zoom level to export. (Default: undefined)

`width`         Image: image width in pixels. (Default: 400)

`height`        Image: image height in pixels. (Default: 400)

`bufferSize`    Mapnik render buffer size. (Default: 128)


## Commands

ProjectMill accepts the following commands. They can be issued either
individually or together.

`--mill`      Generates new tilemill projects based on configuration.

`--render`    Renders projects that are present in configuration and have been milled.

`--upload`    Uploads projects that are present in configuration and have been rendered.


## Options

-t      Path to the TileMill install

-c      specify a configuration file. (Defaults: `./config.json`)

-p      Path to TileMill project folder. (Defaults: `~/Documents/Mapbox`)

-f      Replace existing projects (together with `mill`) or existing projects and exports (together with `render`).
