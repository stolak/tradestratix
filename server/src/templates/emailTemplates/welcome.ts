export function welcomeEmailTemplate(params: { fullName: string; businessName: string }) {
  return {
    subject: `Welcome to TradeStratix — ${params.businessName}`,
    html: `<p>Hello ${params.fullName},</p>
<p>Your TradeStratix account for <strong>${params.businessName}</strong> is ready.</p>
<p>Sign in to configure branches, warehouses, users and your chart of accounts.</p>`
  };
}
