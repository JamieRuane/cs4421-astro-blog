import type { APIRoute } from 'astro';

export const GET = (() => {
    return new Response(
        JSON.stringify({
            status: 'healthy',
        }),
        {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        },
    );
}) satisfies APIRoute;