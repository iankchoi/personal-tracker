import { signIn } from "../../../auth";

export default function SignInPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--ground)",
        color: "var(--text)",
      }}
    >
      <form
        action={async () => {
          "use server";
          await signIn("google");
        }}
      >
        <button
          type="submit"
          style={{
            height: 38,
            padding: "0 18px",
            border: 0,
            borderRadius: 999,
            background: "var(--text)",
            color: "var(--ground)",
            font: "inherit",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
