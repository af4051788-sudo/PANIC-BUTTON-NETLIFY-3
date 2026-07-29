export default {
  providers: [
    {
      // @convex-dev/auth exposes its own OIDC endpoint at the Convex site URL
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
