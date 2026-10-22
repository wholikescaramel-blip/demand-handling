export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="login card">
      <h1>Demand Planning Desk</h1>
      <p className="sub">Sign in with your name and the team password. Your name is recorded on every decision.</p>
      <form method="post" action="/api/login">
        <label htmlFor="name" className="small dim">Your name</label>
        <input id="name" name="name" type="text" autoComplete="name" maxLength={60} required />
        <label htmlFor="password" className="small dim">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" autoFocus required />
        {error ? <p className="err" role="alert">That password did not match.</p> : null}
        <button type="submit">Sign in</button>
      </form>
    </div>
  );
}
