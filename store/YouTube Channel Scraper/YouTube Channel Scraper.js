// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities.js"

const Buster = require("phantombuster")
const buster = new Buster()

const Nick = require("nickjs")
const nick = new Nick({
	loadImages: false,
	printPageErrors: false,
	printResourceErrors: false,
	printNavigation: false,
	printAborts: false,
	debug: false,
	timeout: 30000
})
const StoreUtilities = require("./lib-StoreUtilities")
const utils = new StoreUtilities(nick, buster)


/**
 * @description Tiny function used to check if a given string represents a Facebook URL
 * @param { String } urm
 * @return { Boolean } true if target represents an Facebook URL otherwise false
 */
const isYouTubeUrl = (url) => {
	try {
		const { URL } = require("url")
		let urlObject = new URL(url.toLowerCase())
		if (urlObject.hostname.includes("youtube.com")) {
			return true
		}
	} catch (err) {
		//
	}
	return false
	}

const getUrlsToScrape = (data, numberOfProfilesPerLaunch) => {
	data = data.filter((item, pos) => data.indexOf(item) === pos)
	const maxLength = data.length
	if (maxLength === 0) {
		utils.log("Input spreadsheet is empty OR we already scraped all the profiles from this spreadsheet.", "warning")
		nick.exit()
	}
	return data.slice(0, Math.min(numberOfProfilesPerLaunch, maxLength)) // return the first elements
}

const scrapeChannelData = (arg, cb) => {
	const scrapedData = {}
	if (document.querySelector("#channel-title")) {
		scrapedData.channelTitle = document.querySelector("#channel-title").textContent
	}
	if (document.querySelector("#subscriber-count")) {
		scrapedData.subscriberCount = parseInt(document.querySelector("#subscriber-count").textContent.replace(/\D+/g, ""), 10)
	}
	if (document.querySelector("#description")) {
		scrapedData.description = document.querySelector("#description").textContent.trim()
	}
	if (document.querySelector("#right-column > yt-formatted-string:nth-of-type(2)")) {
		scrapedData.joinedDate = document.querySelector("#right-column > yt-formatted-string:nth-of-type(2)").textContent
	}
	if (document.querySelector("#right-column > yt-formatted-string:nth-of-type(3)")) {
		scrapedData.viewCount = parseInt(document.querySelector("#right-column > yt-formatted-string:nth-of-type(3)").textContent.replace(/\D+/g, ""), 10)
	}
	if (document.querySelector("#details-container > table tr:last-of-type > td:last-of-type")) {
		scrapedData.country = document.querySelector("#details-container > table tr:last-of-type > td:last-of-type").textContent.trim()
	}
	const links = Array.from(document.querySelectorAll("#link-list-container > a"))
	links.forEach(el => {
		const camelCaser = str => {
			str = str.toLowerCase().split(" ")
			for (let i = 1; i < str.length; i++) {
			if (str[i]) {
				str[i] = str[i].charAt(0).toUpperCase() + str[i].substr(1)
			}
			}
			str = str.join("")
			return str
		}
		const redirectedUrl = new URL(el.href).searchParams.get("q")
		if (redirectedUrl) {
			if (redirectedUrl.includes("twitter.com/")) {
				scrapedData.twitterUrl = redirectedUrl
			} else if (redirectedUrl.includes("facebook.com/")) {
				scrapedData.facebookUrl = redirectedUrl
			} else if (redirectedUrl.includes("instagram.com/")) {
				scrapedData.instagramUrl = redirectedUrl
			} else if (redirectedUrl.includes("patreon.com/")) {
				scrapedData.patreonUrl = redirectedUrl
			} else if (redirectedUrl.includes("paypal.me/")) {
				scrapedData.paypal = redirectedUrl
			} else if (redirectedUrl.includes("plus.google.com/")) {
				scrapedData.googlePlus = redirectedUrl
			} else {
				const linkName = camelCaser(el.textContent.trim()) + "Url"
				scrapedData[linkName] = redirectedUrl
			}
		}
	})
	scrapedData.query = arg.channelUrl
	scrapedData.timestamp = (new Date()).toISOString()
	cb(null, scrapedData)
}

const clickAboutTab = (arg, cb) => {
	try {
		const aboutTab = Array.from(document.querySelectorAll("#tabsContent > paper-tab")).filter(el => el.textContent.trim() === "About")[0]
		cb(null, aboutTab.click())
	} catch (err) {
		cb(null, null)
	}
}

const loadAndScrapeChannel = async (tab, channelUrl) => {
	await tab.open(channelUrl)
	utils.log(`Opening ${channelUrl}`, "loading")
	await tab.waitUntilVisible("#tabsContent", 10000)
	await tab.wait(3000)
	await tab.evaluate(clickAboutTab)
	await tab.waitUntilVisible("#right-column")
	const scrapedData = await tab.evaluate(scrapeChannelData, { channelUrl })
	utils.log(`Scraped channel of ${scrapedData.channelTitle}.`, "done")
	return scrapedData
}

// Main function to launch all the others in the good order and handle some errors
nick.newTab().then(async (tab) => {
	let { channelUrls, spreadsheetUrl, columnName, channelsPerLaunch, csvName } = utils.validateArguments()
	if (!csvName) { csvName = "result" }
	let singleProfile
	if (spreadsheetUrl) {
		if (isYouTubeUrl(spreadsheetUrl)) { // single YouTube url
			channelUrls = [spreadsheetUrl]
			singleProfile = true
		} else { // CSV
			channelUrls = await utils.getDataFromCsv2(spreadsheetUrl, columnName)
		}
	} else if (typeof channelUrls === "string") {
		channelUrls = [channelUrls]
		singleProfile = true
	}
	let result = await utils.getDb(csvName + ".csv")
	if (!singleProfile) {
		channelUrls = channelUrls.filter(str => str) // removing empty lines
		if (!channelsPerLaunch) {
			channelsPerLaunch = channelUrls.length
		}
		channelUrls = getUrlsToScrape(channelUrls.filter(el => utils.checkDb(el, result, "query")), channelsPerLaunch)
	}
	console.log(`URLs to scrape: ${JSON.stringify(channelUrls.slice(0, 500), null, 4)}`)
	let tempResult = []
	for (const channelUrl of channelUrls) {
		if (isYouTubeUrl(channelUrl)) {
			try {
				tempResult.push(await loadAndScrapeChannel(tab, channelUrl))
			} catch (err) {
				utils.log("Couldn't access this channel About page.", "error")
				tempResult.push({ timestamp: (new Date()).toISOString(), query: channelUrl, error: "Couln't access About page" })
			}
			result = result.concat(tempResult)
			const timeLeft = await utils.checkTimeLeft()
			if (!timeLeft.timeLeft) {
				utils.log(timeLeft.message, "warning")
				break
			}
		} else {
			utils.log(`${channelUrl} isn't a YouTube Channel URL, skipping entry...`, "warning")
		}
	}
	result.push(...tempResult)
	await utils.saveResults(tempResult, result, csvName)
	utils.log("Job is done!", "done")
	nick.exit(0)
})
.catch((err) => {
	utils.log(err, "error")
	nick.exit(1)
})
