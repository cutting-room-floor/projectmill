ProjectMill
-----------

Need to generate a bunch of TileMill projects that are nearly identical and
then render them all out? What to script that? We gotcha covered.

Usage: ./index.js <command> [options]


## Configuration

Configuration is expected as an json file which contains an array as the root
object. Each element in the array should be an object which can have the
following keys:

`source`        REQUIRED The source project, generally the name of folder it
                lives in.

`destintion`    REQUIRED The destintion project name.

`mml`           A json snippet which will be merged on top of the project's mml
                file. To clear out an option set it to 'null'

`cartoVars`     A json object containing key value pairs which can be use to
                override variables in in carto stylesheets.

`MBmeta`        MBTiles: A json object containing key value pairs which will be added to
                a rendered MBtiles export.

Additionally, the following options will be passed to TileMill's export commnd

`format`        Export format (png|pdf|svg|mbtiles). (Default: undefined)

`bbox`          Comma separated coordinates of bounding box to export. (Default: undefined)

`minzoom`       MBTiles: minimum zoom level to export. (Default: undefined)

`maxzoom`       MBTiles: maximum zoom level to export. (Default: undefined)

`width`         Image: image width in pixels. (Default: 400)

`height`        Image: image height in pixels. (Default: 400)

`bufferSize`    Mapnik render buffer size. (Default: 128)


## Commands

`mill`      Generate new tilemill projects based on the configuration.

`render`    NOT IMPLEMENTED Render projects (and mill them first if required).

`upload`    NOT IMPLEMENTED Uploads projects to MapBox hosting (Mill and render first if required);


## Options

-t      Path to the TileMill install

-c      specify a config file. (Defaults: `./config.json`)

-p      Path to TileMill project folder. (Defaults: `~/Documents/Mapbox/project`)
