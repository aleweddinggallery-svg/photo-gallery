require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const app = express();
const port = process.env.PORT || 3000; 

// Middleware para cookies y sesiones
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET, 
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // Duración de la cookie: 1 día
}));

// Decodificar la clave de servicio de base64 a JSON
const serviceAccount = JSON.parse(Buffer.from(process.env.SERVICE_ACCOUNT_KEY, 'base64').toString());

const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
});

const drive = google.drive({
    version: 'v3',
    auth
});

const upload = multer({ dest: '/tmp/uploads/' });

app.get('/', (req, res) => {
    if (!req.session.uploads) {
        req.session.uploads = 0;
    }
    res.sendFile(path.join(__dirname, '/index.html'));
});

function uploadMiddleware(req, res, next) {
    const uploadHandler = upload.array('photos', 10);

    uploadHandler(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                // Envía una respuesta HTML con un botón para regresar
                res.status(400).send(`
                    <p>No puedes subir más de 10 fotos.</p>
                    <button onclick="history.back()">Regresar</button>
                `);
            } else {
                // Manejo de otros errores de Multer
                res.status(500).send(err.message);
            }
        } else if (err) {
            // Manejo de otros errores desconocidos
            res.status(500).send(err.message);
        } else {
            // No hay errores, continuar
            next();
        }
    });
}

app.post('/upload', uploadMiddleware, async (req, res) => {
    if (req.files.length === 0) {
        return res.status(400).send('No se recibieron archivos.');
    }

    try {
        // Subir todos los archivos en paralelo en vez de uno por uno
        const uploadPromises = req.files.map(file => {
            const fileMetadata = {
                name: file.originalname,
                parents: [process.env.DRIVE_FOLDER_ID]
            };
            const media = {
                mimeType: file.mimetype,
                body: fs.createReadStream(file.path)
            };
            return drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id'
            });
        });

        const responses = await Promise.all(uploadPromises);

        // Limpiar archivos temporales en paralelo también
        await Promise.all(req.files.map(file => fs.promises.unlink(file.path)));

        const ids = responses.map(r => r.data.id);
        res.status(200).send(`Archivos subidos con éxito: ${ids.join(', ')}`);
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al subir los archivos');
    }
});


app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});
