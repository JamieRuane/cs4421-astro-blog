import type { APIRoute } from 'astro';

export const prerender = false;

const latitude = 52.5997;
const longitude = -8.9756;

type OpenMeteoResponse = {
	current?: {
		temperature_2m?: number;
		relative_humidity_2m?: number;
		apparent_temperature?: number;
		precipitation?: number;
		weather_code?: number;
		wind_speed_10m?: number;
	};
	current_units?: Record<string, string>;
};

export const GET: APIRoute = async () => {
	const url = new URL('https://api.open-meteo.com/v1/forecast');
	url.searchParams.set('latitude', String(latitude));
	url.searchParams.set('longitude', String(longitude));
	url.searchParams.set(
		'current',
		[
			'temperature_2m',
			'relative_humidity_2m',
			'apparent_temperature',
			'precipitation',
			'weather_code',
			'wind_speed_10m',
		].join(','),
	);
	url.searchParams.set('timezone', 'auto');

	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!response.ok) {
			throw new Error(`Open-Meteo returned HTTP ${response.status}`);
		}

		const data: OpenMeteoResponse = await response.json();
		if (!data.current) {
			throw new Error('Open-Meteo response did not include current weather data');
		}

		return new Response(
			JSON.stringify({
				location: 'Askeaton, County Limerick',
				latitude,
				longitude,
				current: data.current,
				current_units: data.current_units,
			}),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json; charset=utf-8',
					'Cache-Control': 'public, max-age=600, s-maxage=1800, stale-while-revalidate=3600',
				},
			},
		);
	} catch (error) {
		const reason = error instanceof Error ? error.message : 'Unknown upstream error';
		console.error(JSON.stringify({
			level: 'error',
			event: 'weather.fetch_failed',
			timestamp: new Date().toISOString(),
			reason,
		}));
		return new Response(
			JSON.stringify({ status: 'error', error: 'Weather data is temporarily unavailable.' }),
			{
				status: 502,
				headers: {
					'Content-Type': 'application/json; charset=utf-8',
					'Cache-Control': 'no-store',
				},
			},
		);
	}
};
