const fs = require('fs');

let c = fs.readFileSync('src/routes/meta.js', 'utf8');

c = c.replace(/res\.cookie\('meta_oauth_tenant', req\.usuario\.tenantId, \{/g, `res.cookie('meta_oauth_tenant', req.usuario.tenantId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 10 * 60 * 1000
    });

    res.cookie('meta_oauth_user', req.usuario.id, {`);

c = c.replace(/const tenantId = req\.cookies\?\.meta_oauth_tenant;/g, `const tenantId = req.cookies?.meta_oauth_tenant;
    const userId = req.cookies?.meta_oauth_user;`);

c = c.replace(/!tenantId/g, `!tenantId || !userId`);

c = c.replace(/where: \{ inquilino_id: tenantId, business_id: business\.id \}/g, `where: { inquilino_id: tenantId, usuario_id: userId, business_id: business.id }`);

c = c.replace(/inquilino_id: tenantId,/g, `inquilino_id: tenantId,
                usuario_id: userId,`);

c = c.replace(/res\.clearCookie\('meta_oauth_tenant'\);/g, `res.clearCookie('meta_oauth_tenant');
        res.clearCookie('meta_oauth_user');`);

c = c.replace(/where: \{ inquilino_id: req\.usuario\.tenantId, estado: 'conectado' \}/g, `where: { inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id, estado: 'conectado' }`);

c = c.replace(/where: \{ inquilino_id: req\.usuario\.tenantId \}/g, `where: { inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id }`);

c = c.replace(/where: \{ id: req\.params\.id, inquilino_id: req\.usuario\.tenantId \}/g, `where: { id: req.params.id, inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id }`);

c = c.replace(/id: store_id, inquilino_id: req\.usuario\.tenantId, estado: 'conectado'/g, `id: store_id, inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id, estado: 'conectado'`);

c = c.replace(/inquilino_id: req\.usuario\.tenantId, estado: 'conectado'/g, `inquilino_id: req.usuario.tenantId, usuario_id: req.usuario.id, estado: 'conectado'`);

fs.writeFileSync('src/routes/meta.js', c);
console.log('meta.js updated successfully');
