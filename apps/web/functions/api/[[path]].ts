export async function onRequest(context: {
  request: Request;
  env: Env;
}) {
  const apiOrigin = context.env.API_ORIGIN;
  if (!apiOrigin) {
    return Response.json({ error: "API_ORIGIN is not configured" }, { status: 500 });
  }

  const url = new URL(context.request.url);
  const target = new URL(url.pathname + url.search, apiOrigin);

  return fetch(target, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
    redirect: "manual"
  });
}

type Env = {
  API_ORIGIN: string;
};
