if (process.env.NODE_ENV === "production")
  throw Error("Demo seeds are forbidden in production");
throw Error(
  "Shared-password seeds were removed. Use npm test for isolated synthetic users, or sign up through the app.",
);
