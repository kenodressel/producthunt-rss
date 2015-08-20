/**
 * Created by Ardobras on 20.08.2015.
 */

var express = require('express'),
    app = express();
var unirest = require('unirest');
var rss = require('rss');
var fs = require('fs');
var moment = require('moment');
var CronJob = require('cron').CronJob;

//Run init() on startup
init();

//Create a cronjob that runs ever 5 minutes.
new CronJob('0 */5 * * * *', function () {
    cronRun();
}, null, true, "America/Los_Angeles");

var config = require('./config');

var ph = {
    'access_token': null,
    'expires': null,
    'limit': 50 //Min Upvotes to be published
};

/**
 * Creates the directory 'data' if it not exists and runs the inital generation of the rss.xml
 */
function init() {
    if (!fs.existsSync(__dirname + "/data")) {
        //Create data directory
        fs.mkdirSync(__dirname + "/data", 0766, function (err) {
            if (err) console.log(err);
        });

        //Create dummy posts.json file
        fs.writeFile(__dirname + '/data/posts.json', '[]');
    }

    cronRun();

}

/**
 * Get's an access token from the producthunt API
 * @param cb
 */

function auth(cb) {
    unirest.post('https://api.producthunt.com/v1/oauth/token')
        .header('Accept', 'application/json')
        .send({
            'client_id': config.client_id,
            'client_secret': config.client_secret,
            'grant_type': "client_credentials"
        })
        .end(function (response) {
            if (response.body.error) {
                console.error(response.body.error_description);
            } else {
                ph.access_token = response.body.access_token;
                ph.expires = response.body.expires_in * 1000 + Date.now();
                cb();
            }
        });
}

/**
 * Querys the current featured posts fro the producthunt API
 * @param cb
 */

function getCurrentPosts(cb) {
    if (ph.expires > Date.now()) {
        unirest.get('https://api.producthunt.com/v1/posts')
            .header('Accept', 'application/json')
            .header('Authorization', 'Bearer ' + ph.access_token)
            .end(function (response) {
                cb(response.body.posts);
            });
    } else {
        auth(function () {
            getCurrentPosts(cb)
        });
    }
}

/**
 * Reads the saved JSON and compares it to the current available posts
 * If new posts occure it will regenerate the rss.xml
 */

function cronRun() {
    fs.readFile(__dirname + '/data/posts.json', function (err, json) {
        if (err) { //First time init
            console.error(err);
            json = '[]';
        }

        var data = {
            'posts': JSON.parse(json),
            'new': false
        };

        getCurrentPosts(function (new_posts) {
            new_posts.forEach(function (post) {
                if (post.votes_count > ph.limit && !findById(data.posts, post.id)) {
                    data.new = true;
                    data.posts.unshift(post);
                }
            });

            if (data.new) { // Found new post

                if (data.posts.length > 50) data.posts = data.posts.slice(0, 10);
                fs.writeFileSync(__dirname + '/data/posts.json', JSON.stringify(data.posts));
                renderRSS();
            }

        });
    });
}

/**
 * (re)Renders the RSS from the posts.json
 */

function renderRSS() {
    /* lets create an rss feed */
    var feed = new rss({
        title: 'Product Hunt RSS',
        description: 'Product Hunt is a curation of the best new products, every day. Discover the latest mobile apps, websites, and technology products that everyone&#39;s talking about.',
        feed_url: 'http://keno.digital/project/producthunt-rss/rss.xml',
        site_url: 'http://producthunt.com',
        image_url: 'http://assets.producthunt.com/assets/ph-ios-icon-f989a27d98b173973ce47298cb86cc0c.png',
        language: 'en',
        pubDate: moment().utc().format('ddd, DD MMM YYYY HH:mm:ss') + ' GMT',
        ttl: '5'
    });

    fs.readFile(__dirname + '/data/posts.json', function (err, json) {
        /* loop over data and add to feed */

        var posts = JSON.parse(json);

        posts.forEach(function (post) {
            feed.item({
                title: post.name,
                description: post.tagline + '<br>' + post.votes_count + 'Upvotes & ' + post.comments_count + ' Comments',
                url: post.redirect_url,
                author: post.user.name,
                date: post.day,
                enclosure: {url: post.screenshot_url['300px']} //  enclosure
            });
        });

        fs.writeFileSync(__dirname + '/data/rss.xml', feed.xml());

    });

}

/**
 * A helper function to comapre if a post is already saved in the file
 * @param posts
 * @param id
 * @returns {boolean}
 */

function findById(posts, id) {
    for (var i = 0; i < posts.length; i++) {
        if (posts[i].id == id) return true
    }
    return false;
}


//Catch all requests and return the rss file
app.get('*', function (req, res) {
    res.sendFile(__dirname + '/data/rss.xml');
});

//Start the express server
app.listen(3000);
