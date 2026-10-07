export const prerender = false;

const WEATHER_CODES: Record<number, string> = {
	0: 'Clear sky',
	1: 'Mainly clear',
	2: 'Partly cloudy',
	3: 'Overcast',
	45: 'Foggy',
	48: 'Depositing rime fog',
	51: 'Light drizzle',
	53: 'Moderate drizzle',
	55: 'Dense drizzle',
	56: 'Freezing drizzle',
	57: 'Heavy freezing drizzle',
	61: 'Slight rain',
	63: 'Moderate rain',
	65: 'Heavy rain',
	66: 'Light freezing rain',
	67: 'Heavy freezing rain',
	71: 'Light snow',
	73: 'Moderate snow',
	75: 'Heavy snow',
	77: 'Snow grains',
	80: 'Rain showers',
	81: 'Heavy showers',
	82: 'Violent showers',
	85: 'Light snow showers',
	86: 'Heavy snow showers',
	95: 'Thunderstorm',
	96: 'Thunderstorm with hail',
	99: 'Severe thunderstorm',
};

const LATITUDE = 52.5997;
const LONGITUDE = -8.9756;

export async function GET() {
	const url = new URL('https://api.open-meteo.com/v1/forecast');
	url.searchParams.set('latitude', String(LATITUDE));
	url.searchParams.set('longitude', String(LONGITUDE));
	url.searchParams.set('current', [
		'temperature_2m',
		'relative_humidity_2m',
		'apparent_temperature',
		'precipitation',
		'weather_code',
		'wind_speed_10m',
		'wind_direction_10m',
	].join(','));
	url.searchParams.set('timezone', 'auto');

	try {
		const response = await fetch(url.toString());
		if (!response.ok) {
			throw new Error(`Weather API returned ${response.status}`);
		}

		const data = await response.json();
		const current = data.current ?? {};
		const weatherCode = Number(current.weather_code ?? 0);

		return new Response(
			JSON.stringify({
				location: 'Askeaton, County Limerick',
				latitude: LATITUDE,
				longitude: LONGITUDE,
				current: {
					temperature_2m: current.temperature_2m ?? null,
					relative_humidity_2m: current.relative_humidity_2m ?? null,
					apparent_temperature: current.apparent_temperature ?? null,
					precipitation: current.precipitation ?? null,
					wind_speed_10m: current.wind_speed_10m ?? null,
					wind_direction_10m: current.wind_direction_10m ?? null,
					weather_code: weatherCode,
					weather_description: WEATHER_CODES[weatherCode] ?? 'Weather unavailable',
				},
			}),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 's-maxage=1800, stale-while-revalidate=3600',
				},
			},
		);
	} catch (error) {
		console.error('Weather API failed', error);
		return new Response(
			JSON.stringify({
				error: 'Unable to fetch the weather forecast for Askeaton right now.',
			}),
			{
				status: 502,
				headers: {
					'Content-Type': 'application/json',
				},
			},
		);
	}
}
