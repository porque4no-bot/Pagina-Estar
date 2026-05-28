\-

\# OTASync Public API — Documentación Completa

\*\*URL:\*\* https://documenter.getpostman.com/view/41568417/2sAYX5MNgD    
\*\*Base URL:\*\* \`https://app.otasync.me/api\`    
\*\*Método:\*\* Todos los endpoints son \`POST\`    
\*\*Autenticación:\*\* La mayoría requiere \`token\` \+ \`key\` (obtenidos desde Login). El campo \`pkey\` de la respuesta Login se usa como \`key\` en todas las demás peticiones.

\---

\#\# Secciones y endpoints con contenido documentado

\#\#\# Secciones SIN contenido publicado (solo aparecen en el menú)  
Las siguientes secciones están listadas en la navegación pero \*\*no tienen documentación\*\* en la página:  
\- Availability → Get availability, Edit availability  
\- Boards → Get boards  
\- Calendar → Get calendar, Edit dates  
\- Channels → Get channels, Get channel, Insert channel, Edit channel, Delete channel  
\- City taxes → Get city taxes, Get city tax, Delete city tax, Insert city tax, Update city tax  
\- Contact → Message  
\- Guests, Prices, Pricing plans  
\- Property → Get property info, Edit property info, Facilities  
\- Restriction plans → Insert, Update, Get plans, Get plan, Delete  
\- Restrictions → Get restrictions, Edit restrictions  
\- Rooms → Get room type, Get room type prices, Get room types with rooms, Edit room status, Get room types, Insert room type  
\- Policies → Insert policy, Get policies, Edit policy  
\- Webhooks → Get active webhooks, Edit webhook, Delete webhook  
\- Statistics → Revenue and paid reservations, Occupancy  
\- Invoices → Get invoice, Insert invoice, Get invoices, Mark invoice as paid, Report advance  
\- Engine → Multiproperties  
\- Reviews → Hotels, Shop, Schedule  
\- Notifications → Insert notification, Get notifications by date, Get notifications by date range, Get notification, Change notification status, Delete notification, Edit notification, Notification number  
\- E-turista → Insert to e turist, Get properties from e turist, Edit guest with data about e turist  
\- Montenegro guest → Insert to guest montenegro, Edit guest with data about Montenegro check in  
\- New reservations → Insert reservation, Edit reservation basic, Update room, Add room in reservation, Remove room, Add extra reservation, Remove extras from reservation, Update extra reservation, Add payment reservation, Remove payment reservation, Get reservation, available RoomTypes And Rooms, Get reservations, Delete reservation, News, reservationPrices, Insert into order montenegro, Search guest, storn order montenegro, Update guest status, POS, Send message  
\- Inventory → update inventory rooms  
\- Banquet → Add extra banquet  
\- Evisitor Companies → Get companies

\---

\#\# 1\. AUTH

\#\#\# POST Login  
\*\*URL:\*\* \`https://app.otasync.me/api/user/auth/login\`

\*\*Descripción:\*\* Autentica al usuario y retorna información del usuario y propiedades. El campo \`pkey\` del objeto \`userInf\` se usa como \`key\` en todas las demás peticiones.

Para obtener usuario/contraseña: https://app.otasync.me/register/    
Para obtener el token de autenticación: https://otasync.me/api.php\#connectivityPartner

\*\*Headers:\*\*  
\`\`\`  
Content-Type: application/json  
\`\`\`

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "username": "\[YOUR\_USERNAME\]",  
  "password": "\[YOUR\_PASSWORD\]",  
  "remember": 0  
}  
\`\`\`

| Parámetro  | Tipo   | Descripción |  
|------------|--------|-------------|  
| token      | string | Token de autenticación de la API |  
| username   | string | Nombre de usuario |  
| password   | string | Contraseña |  
| remember   | number | 1 para recordar sesión, 0 para no |

\*\*Respuesta (200 OK):\*\*  
\`\`\`json  
{  
  "id\_users": 50199,  
  "id\_parent": 0,  
  "status": "confirmed",  
  "username": "djordje.tornjanski@otasync.me",  
  "pwd": "97802bc919615ac05415140b61729bd4192bcc2e",  
  "name": "Djordje",  
  "email": "djordje.tornjanski@otasync.me",  
  "phone": "+381637294859",  
  "address": null,  
  "city": null,  
  "zip": null,  
  "company": null,  
  "country": "RS",  
  "pib": null,  
  "mb": null,  
  "undo\_timer": 60,  
  "notify\_overbooking": 0,  
  "notify\_new\_reservations": 0,  
  "reservations": 3,  
  "guests": 3,  
  "invoices": 3,  
  "prices": 3,  
  "restrictions": 3,  
  "avail": 3,  
  "rooms": 3,  
  "channels": 3,  
  "statistics": 3,  
  "calendar": 3,  
  "pkey": "aef67742d092b285bb81e9ee65c17e0e884371fd",  
  "properties": \[  
    { "name": "Oasis", "id\_properties": "6577" },  
    { "name": "Fares", "id\_properties": "6579" },  
    { "name": "Sokratis", "id\_properties": "7099" }  
  \]  
}  
\`\`\`

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/user/auth/login' \\  
\--header 'Content-Type: application/x-www-form-urlencoded' \\  
\--data-raw '{  
  "token":"a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "username": "djordje.tornjanski@otasync.me",  
  "password": "Pekapro122342134.",  
  "remember": 0  
}'  
\`\`\`

\---

\#\#\# POST Logout  
\*\*URL:\*\* \`https://app.otasync.me/api/user/auth/logout\`

\*\*Descripción:\*\* Cierra la sesión del usuario y elimina la key de la base de datos, dejándola inutilizable para futuras peticiones.

\*\*Headers:\*\*  
\`\`\`  
Content-Type: application/json  
\`\`\`

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "key": "0188a6b40ef1240b94b01825ba38fab4043adb0f"  
}  
\`\`\`

| Parámetro | Tipo   | Requerido | Descripción |  
|-----------|--------|-----------|-------------|  
| key       | string | Sí        | La key a eliminar de la base de datos |

\*\*Respuesta:\*\* \`204 No Content\` (sin body)

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/user/auth/logout' \\  
\--header 'Content-Type: application/json' \\  
\--data '{  
  "key": "0188a6b40ef1240b94b01825ba38fab4043adb0f"  
}'  
\`\`\`

\---

\#\#\# POST One Signal Player ID  
\*\*URL:\*\* \`https://app.otasync.me/api/user/edit/one\_signal\`

\*\*Descripción:\*\* Permite editar los detalles del usuario en One Signal.

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "key": "97d3e00461337d64b0ef1463193451a355ad8c71",  
  "player\_id": "321"  
}  
\`\`\`

| Parámetro | Tipo   | Requerido | Descripción |  
|-----------|--------|-----------|-------------|  
| key       | string | Sí        | API key del usuario en One Signal |  
| player\_id | string | Sí        | ID único del player |

\*\*Respuesta:\*\* Sin body de respuesta

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/user/edit/one\_signal' \\  
\--data '{  
  "key": "97d3e00461337d64b0ef1463193451a355ad8c71",  
  "player\_id": "321"  
}'  
\`\`\`

\---

\#\# 2\. BOARDS

\#\#\# POST Update Boards Prices  
\*\*URL:\*\* \`https://app.otasync.me/api/boards/edit/boards\`

\*\*Descripción:\*\* Actualiza los precios de múltiples boards al mismo tiempo.

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_properties": 93,  
  "boards": \[  
    {  
      "price\_children\_1": 5,  
      "price\_children\_2": 0,  
      "price\_children\_3": 0,  
      "price\_adults": 10,  
      "price\_seniors": 0,  
      "id\_board\_names": 1  
    },  
    {  
      "price\_children\_1": 50,  
      "price\_children\_2": 0,  
      "price\_children\_3": 0,  
      "price\_adults": 50,  
      "price\_seniors": 0,  
      "id\_board\_names": 2  
    },  
    {  
      "price\_children\_1": 10,  
      "price\_children\_2": 10,  
      "price\_children\_3": 10,  
      "price\_adults": 10,  
      "price\_seniors": 10,  
      "id\_board\_names": 3  
    }  
  \]  
}  
\`\`\`

| Parámetro          | Tipo   | Descripción |  
|--------------------|--------|-------------|  
| token              | string | Token de autenticación |  
| key                | string | Key única para la petición |  
| id\_properties      | number | ID de la propiedad |  
| boards             | array  | Array de objetos de board |  
| price\_children\_1   | number | Precio para niños categoría 1 |  
| price\_children\_2   | number | Precio para niños categoría 2 |  
| price\_children\_3   | number | Precio para niños categoría 3 |  
| price\_adults       | number | Precio para adultos |  
| price\_seniors      | number | Precio para seniors |  
| id\_board\_names     | number | ID del nombre del board |

\*\*Respuesta (204 No Content):\*\* Sin body

\*\*Schema de respuesta:\*\*  
\`\`\`json  
{  
  "status": "string",  
  "message": "string",  
  "data": "object"  
}  
\`\`\`

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/boards/edit/boards' \\  
\--data '{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_properties": 93,  
  "boards": \[{"price\_adults": 10, "id\_board\_names": 1}\]  
}'  
\`\`\`

\---

\#\# 3\. EXTRAS

\#\#\# POST Get Extra  
\*\*URL:\*\* \`https://app.otasync.me/api/extras/data/extra\`

\*\*Descripción:\*\* Obtiene información de un extra. La respuesta incluye el extra con la lista de habitaciones que ya tienen este extra incluido (\`room\_types\_extras\`) y la lista \`extras\_room\_types\`. Si \`extras\_room\_types\` no está vacía, el extra solo estará disponible para esas habitaciones.

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_extras": 16,  
  "id\_properties": 93  
}  
\`\`\`

| Parámetro     | Tipo   | Descripción |  
|---------------|--------|-------------|  
| token         | string | Token de autenticación |  
| key           | string | Key de la petición |  
| id\_extras     | number | ID del extra |  
| id\_properties | number | ID de la propiedad |

\*\*Respuesta (200 OK):\*\*  
\`\`\`json  
{  
  "id\_properties": 93,  
  "id\_extras": 16,  
  "name": "Extras 1",  
  "description": "",  
  "price": 1179,  
  "type": "one",  
  "tax": "0",  
  "id\_extras\_category": 0,  
  "period\_type": "period",  
  "dfrom": "0001-01-01",  
  "dto": "0001-01-01",  
  "id\_restriction\_plans": 0,  
  "image": "",  
  "use\_on\_booking\_engine": 1,  
  "date\_created": "2021-05-31 18:10:06",  
  "mandatory": 0,  
  "category\_name": null,  
  "category\_image": null,  
  "use\_on\_home\_guest\_app": null,  
  "owner\_fee": 0,  
  "agent\_fee": 0,  
  "extras\_room\_types": \[\],  
  "room\_types\_extras": \[\],  
  "restrictionExtras": null,  
  "mandatory\_room\_types": \[\]  
}  
\`\`\`

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/extras/data/extra' \\  
\--data '{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_extras": 16,  
  "id\_properties": 93  
}'  
\`\`\`

\---

\#\#\# POST Delete Extra  
\*\*URL:\*\* \`https://app.otasync.me/api/extras/delete/extra\`

\*\*Descripción:\*\* Elimina un extra por ID.

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_extras": 17,  
  "id\_properties": 93  
}  
\`\`\`

| Parámetro     | Tipo   | Descripción |  
|---------------|--------|-------------|  
| token         | string | Token de autenticación |  
| key           | string | Key de la petición |  
| id\_extras     | number | ID del extra a eliminar |  
| id\_properties | number | ID de la propiedad |

\*\*Respuesta (200 OK):\*\*  
\`\`\`json  
{  
  "id\_extras": 17,  
  "id\_changelog": 12197816  
}  
\`\`\`

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/extras/delete/extra' \\  
\--data '{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_extras": 17,  
  "id\_properties": 93  
}'  
\`\`\`

\---

\#\# 4\. ROOMS

\#\#\# POST Get Available Room Types  
\*\*URL:\*\* \`https://app.otasync.me/api/room/data/available\_rooms\`

\*\*Descripción:\*\* Recupera la lista de todos los tipos de habitación disponibles para una propiedad específica.

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "key": "34df0741e0b24bca1fe4b2c3d1a412c24be65aaa",  
  "id\_properties": 804,  
  "token": "8fba58c5d62f576e0ac309b42df176190f84510d",  
  "dfrom": "2022-05-21",  
  "dto": "2022-05-29",  
  "id\_pricing\_plans": "2292",  
  "include\_id\_reservations": 0,  
  "exclude\_id\_rooms": \[\]  
}  
\`\`\`

| Parámetro               | Tipo   | Descripción |  
|-------------------------|--------|-------------|  
| key                     | string | Key de autenticación |  
| id\_properties           | number | ID de la propiedad |  
| token                   | string | Token de autenticación |  
| dfrom                   | string | Fecha inicio (YYYY-MM-DD) |  
| dto                     | string | Fecha fin (YYYY-MM-DD) |  
| id\_pricing\_plans        | string | ID del plan de precios |  
| include\_id\_reservations | number | 1 para incluir reservas, 0 para no |  
| exclude\_id\_rooms        | array  | IDs de habitaciones a excluir |

\*\*Respuesta:\*\* Sin body de respuesta documentado

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/room/data/available\_rooms' \\  
\--data '{  
  "key": "34df0741e0b24bca1fe4b2c3d1a412c24be65aaa",  
  "id\_properties": 804,  
  "token": "8fba58c5d62f576e0ac309b42df176190f84510d",  
  "dfrom": "2022-05-21",  
  "dto": "2022-05-29",  
  "id\_pricing\_plans": "2292",  
  "include\_id\_reservations": 0,  
  "exclude\_id\_rooms": \[\]  
}'  
\`\`\`

\---

\#\#\# POST Get Available Room Types and Rooms  
\*\*URL:\*\* \`https://app.otasync.me/api/room/data/available\_rooms\`

\*\*Descripción:\*\* Recupera la lista de tipos de habitación disponibles con sus habitaciones para una propiedad específica.

\*\*Request Body:\*\* (igual a Get Available Room Types)  
\`\`\`json  
{  
  "key": "34df0741e0b24bca1fe4b2c3d1a412c24be65aaa",  
  "id\_properties": 804,  
  "token": "8fba58c5d62f576e0ac309b42df176190f84510d",  
  "dfrom": "2022-05-21",  
  "dto": "2022-05-29",  
  "id\_pricing\_plans": "2292",  
  "include\_id\_reservations": 0,  
  "exclude\_id\_rooms": \[\]  
}  
\`\`\`

\*\*Respuesta:\*\* Sin body de respuesta documentado

\---

\#\#\# POST Get Available Rooms  
\*\*URL:\*\* \`https://app.otasync.me/api/room/data/available\_rooms\`

\*\*Descripción:\*\* Retorna la lista de todas las habitaciones disponibles según los parámetros proporcionados.

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "id\_properties": "93",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "dfrom": "2022-06-01",  
  "dto": "2022-06-02",  
  "id\_room\_types": 170,  
  "id\_pricing\_plans": 370  
}  
\`\`\`

| Parámetro       | Tipo   | Descripción |  
|-----------------|--------|-------------|  
| token           | string | Token de autenticación |  
| id\_properties   | string | ID de la propiedad |  
| key             | string | Key de la API |  
| dfrom           | string | Fecha inicio del check disponibilidad |  
| dto             | string | Fecha fin del check disponibilidad |  
| id\_room\_types   | number | ID del tipo de habitación |  
| id\_pricing\_plans| number | ID del plan de precios |

\*\*Respuesta (200 OK):\*\*  
\`\`\`json  
{  
  "status": "ok",  
  "rooms": \[  
    { "name": "AA", "id\_room\_types": "170", "id\_rooms": "323" },  
    { "name": "2A3", "id\_room\_types": "170", "id\_rooms": "324" }  
  \],  
  "prices": null,  
  "occupancy": "50",  
  "children\_prices": {  
    "children\_1\_amount": "100",  
    "children\_1\_variation\_type": "percent",  
    "children\_2\_amount": "100",  
    "children\_2\_variation\_type": "percent",  
    "seniors\_amount": "100",  
    "seniors\_variation\_type": "percent",  
    "prices\_per\_person": "0"  
  },  
  "prices\_per\_person": \[\]  
}  
\`\`\`

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/room/data/available\_rooms' \\  
\--data '{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "id\_properties": "93",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "dfrom": "2022-06-01",  
  "dto": "2022-06-02",  
  "id\_room\_types": 170,  
  "id\_pricing\_plans": 370  
}'  
\`\`\`

\---

\#\#\# POST Get Out of Services  
\*\*URL:\*\* No documentada (sin URL publicada)

\*\*Descripción:\*\* Petición HTTP POST para recuperar habitaciones fuera de servicio según los parámetros proporcionados.

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "id\_properties": "93",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "dfrom": "2022-06-01",  
  "dto": "2022-06-02",  
  "id\_room\_types": 170,  
  "id\_pricing\_plans": 370  
}  
\`\`\`

\*\*Respuesta:\*\* Sin body de respuesta documentado

\---

\#\#\# POST Change Room Status  
\*\*URL:\*\* \`https://app.otasync.me/api/room/edit/roomStatus\`

\*\*Descripción:\*\* Permite editar el estado de limpieza de una habitación.

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "id\_properties": "93",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_rooms": 11142,  
  "status": "dirty"  
}  
\`\`\`

| Parámetro     | Tipo   | Descripción |  
|---------------|--------|-------------|  
| token         | string | Token de autenticación |  
| id\_properties | string | ID de la propiedad |  
| key           | string | Key de autorización |  
| id\_rooms      | number | ID de la habitación |  
| status        | string | Nuevo estado: \`"dirty"\`, \`"clean"\`, etc. |

\*\*Respuesta (200 OK):\*\*  
\`\`\`json  
{  
  "id\_rooms": "11142",  
  "status": "dirty"  
}  
\`\`\`

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/room/edit/roomStatus' \\  
\--data '{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "id\_properties": "93",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_rooms": 11142,  
  "status": "dirty"  
}'  
\`\`\`

\---

\#\#\# POST Edit Room Type  
\*\*URL:\*\* \`https://app.otasync.me/api/room/edit/room\`

\*\*Descripción:\*\* Permite editar la información de un tipo de habitación.

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "e5fe4eb551084b5f4ca17ec154d06193c10769cc",  
  "id\_properties": "93",  
  "id\_room\_types": 12699,  
  "name": "Test Room 12",  
  "shortname": "TR12",  
  "type": "room",  
  "price": "100",  
  "avail": "2",  
  "booking\_engine": 1,  
  "occupancy": "3",  
  "area": "100",  
  "bathrooms": "1",  
  "houserooms": \[  
    {  
      "name": "Living Area",  
      "beds": \[null\]  
    },  
    {  
      "name": "Bedroom",  
      "beds": \["Queen Bed", "Double Bed"\]  
    }  
  \],  
  "room\_numbers": \["A", "B"\],  
  "description": "Description",  
  "amenities": \["air-conditioning", "heading"\],  
  "images": \[\]  
}  
\`\`\`

| Parámetro      | Tipo   | Descripción |  
|----------------|--------|-------------|  
| token          | string | Token de autenticación |  
| key            | string | Key de la petición |  
| id\_properties  | string | ID de la propiedad |  
| id\_room\_types  | number | ID del tipo de habitación |  
| name           | string | Nombre de la habitación |  
| shortname      | string | Nombre corto/código |  
| type           | string | Tipo de habitación |  
| price          | string | Precio |  
| avail          | string | Disponibilidad |  
| booking\_engine | number | Motor de reservas |  
| occupancy      | string | Ocupación máxima |  
| area           | string | Área en m² |  
| bathrooms      | string | Número de baños |  
| houserooms     | array  | Áreas con camas |  
| room\_numbers   | array  | Números/nombres de habitaciones |  
| description    | string | Descripción |  
| amenities      | array  | Lista de amenidades |  
| images         | array  | Lista de imágenes |

\*\*Respuesta (200 OK):\*\*  
\`\`\`json  
{  
  "id\_room\_types": 12699,  
  "id\_changelog": 12231099  
}  
\`\`\`

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/room/edit/room' \\  
\--data '{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "e5fe4eb551084b5f4ca17ec154d06193c10769cc",  
  "id\_properties": "93",  
  "id\_room\_types": 12699,  
  "name": "Test Room 12",  
  "shortname": "TR12",  
  "type": "room",  
  "price": "100"  
}'  
\`\`\`

\---

\#\# 5\. POLICIES

\#\#\# POST Delete Policy  
\*\*URL:\*\* \`https://app.otasync.me/api/policies/delete/policy\`

\*\*Descripción:\*\* Elimina una política específica.

\*\*Headers:\*\*  
\`\`\`  
Content-Type: application/json  
\`\`\`

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "92b2a5ac3099f564e92cc7923212eab268b5db17",  
  "id\_policies": "477",  
  "id\_properties": "93"  
}  
\`\`\`

| Parámetro     | Tipo   | Descripción |  
|---------------|--------|-------------|  
| token         | string | Token de autenticación |  
| key           | string | Key de la petición |  
| id\_policies   | string | ID de la política a eliminar |  
| id\_properties | string | ID de la propiedad |

\*\*Schema de respuesta:\*\*  
\`\`\`json  
{  
  "status": "string",  
  "message": "string"  
}  
\`\`\`

\*\*Respuesta:\*\* Sin body de respuesta documentado

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/policies/delete/policy' \\  
\--data '{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "92b2a5ac3099f564e92cc7923212eab268b5db17",  
  "id\_policies": "477",  
  "id\_properties": "93"  
}'  
\`\`\`

\---

\#\#\# POST Get Policy  
\*\*URL:\*\* \`https://app.otasync.me/api/policies/data/policy\`

\*\*Descripción:\*\* Obtiene los datos de una política por ID.

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "92b2a5ac3099f564e92cc7923212eab268b5db17",  
  "id\_policies": "476",  
  "id\_properties": "93"  
}  
\`\`\`

| Parámetro     | Tipo   | Descripción |  
|---------------|--------|-------------|  
| token         | string | Token de autenticación |  
| key           | string | Key de la petición |  
| id\_policies   | string | ID de la política |  
| id\_properties | string | ID de la propiedad |

\*\*Respuesta:\*\* Sin body de respuesta documentado

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/policies/data/policy' \\  
\--data '{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "92b2a5ac3099f564e92cc7923212eab268b5db17",  
  "id\_policies": "476",  
  "id\_properties": "93"  
}'  
\`\`\`

\---

\#\# 6\. WEBHOOKS

\#\#\# POST Get Active Webhooks / Test Webhook  
\*\*URL Get Active:\*\* \`https://app.otasync.me/api/webhooks/data/webhooks\`    
\*\*URL Test:\*\* \`https://app.otasync.me/api/webhooks/data/test\_webhook\`

\*\*Descripción:\*\* Permite obtener todos los webhooks activos de una propiedad o probar un webhook.

\*\*Request Body (Get Active Webhooks):\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_properties": 93  
}  
\`\`\`

\*\*Request Body (Test Webhook):\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_properties": 93,  
  "data\_type": "reservation"  
}  
\`\`\`

\*\*Respuesta Get Active (200 OK):\*\*  
\`\`\`json  
\[  
  {  
    "id\_properties": "93",  
    "id\_webhooks": "5",  
    "url": "https://front.bits.org.rs/api/webhook",  
    "date\_created": "2022-01-25 22:58:50"  
  },  
  {  
    "id\_properties": "93",  
    "id\_webhooks": "17",  
    "url": "test@url.com",  
    "date\_created": "2022-03-15 11:43:36"  
  }  
\]  
\`\`\`

\*\*Ejemplo cURL (Get Active):\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/webhooks/data/webhooks' \\  
\--data '{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_properties": 93  
}'  
\`\`\`

\---

\#\#\# POST Insert Webhook  
\*\*URL:\*\* \`https://app.otasync.me/api/webhooks/insert/webhook\`

\*\*Descripción:\*\* Inserta un nuevo webhook para la propiedad. El webhook enviará un POST en formato JSON a la URL especificada cuando ocurran ciertos eventos.

\*\*Acciones del Webhook:\*\*  
\- Nueva reserva: \`data\_type="reservation"\`, \`action="insert"\`, \`data=objeto reservation\`  
\- Reserva actualizada: \`data\_type="reservation"\`, \`action="edit"\`  
\- Estado de huésped actualizado: \`data\_type="reservation"\`, \`action="edit"\`  
\- Reserva cancelada: \`data\_type="reservation"\`, \`action="cancel"\`  
\- Actualización de disponibilidad: \`data\_type="avail"\`, \`action="edit"\`, \`data={id\_room\_types \=\> date \=\> value}\`  
\- Actualización de precios: \`data\_type="prices"\`, \`action="edit"\`  
\- Actualización de restricciones: \`data\_type="restrictions"\`, \`action="edit"\`

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_properties": 93,  
  "url": "test@url.com"  
}  
\`\`\`

| Parámetro     | Tipo   | Descripción |  
|---------------|--------|-------------|  
| token         | string | Token de autenticación |  
| key           | string | Key de autenticación |  
| id\_properties | number | ID de la propiedad |  
| url           | string | URL a la que el webhook enviará el POST |

\*\*Respuesta (201 Created):\*\*  
\`\`\`json  
{  
  "id\_webhooks": 300  
}  
\`\`\`

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/webhooks/insert/webhook' \\  
\--data-raw '{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_properties": 93,  
  "url": "test@url.com"  
}'  
\`\`\`

\---

\#\# 7\. STATISTICS

\#\#\# POST Get Statistics Table  
\*\*URL:\*\* \`https://app.otasync.me/api/statistics/data/statistics\_table\`

\*\*Descripción:\*\* Recupera datos de la tabla de estadísticas filtrados por fecha y criterio.

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_properties": 93,  
  "dfrom": "2023-03-14",  
  "dto": "2023-03-15",  
  "filter\_by": 1  
}  
\`\`\`

| Parámetro     | Tipo    | Descripción |  
|---------------|---------|-------------|  
| token         | string  | Token de autenticación |  
| key           | string  | Key de autorización |  
| id\_properties | integer | ID de la propiedad |  
| dfrom         | string  | Fecha inicio |  
| dto           | string  | Fecha fin |  
| filter\_by     | integer | Criterio de filtrado |

\*\*Respuesta (200 OK):\*\* Retorna un objeto \`data\` con arrays de \`channels\` (canales con estadísticas) y \`rooms\` (tipos de habitación con estadísticas). Cada canal incluye: \`avg\_income\`, \`canceled\`, \`canceled\_count\`, \`commission\`, \`confirmed\`, \`count\`, \`earnings\`, \`id\`, \`income\`, \`logo\`, \`name\`, \`nights\`. Cada habitación incluye: \`avg\_income\`, \`avg\_nights\`, \`count\`, \`id\`, \`income\`, \`nights\`, \`shortname\`.

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/statistics/data/statistics\_table' \\  
\--data '{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_properties": 93,  
  "dfrom": "2023-03-14",  
  "dto": "2023-03-15",  
  "filter\_by": 1  
}'  
\`\`\`

\---

\#\#\# POST Average Night  
\*\*URL:\*\* \`https://app.otasync.me/api/statistics/data/average\_night\`

\*\*Descripción:\*\* Recupera estadísticas de duración media de estancias (noches).

\*\*Request Body:\*\*  
\`\`\`json  
{  
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",  
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",  
  "id\_properties": 93,  
  "compare\_year": 2023  
}  
\`\`\`

| Parámetro     | Tipo    | Descripción |  
|---------------|---------|-------------|  
| token         | string  | Token de autenticación |  
| key           | string  | Key de autorización |  
| id\_properties | integer | ID de la propiedad |  
| compare\_year  | integer | Año con el que comparar |

\*\*Respuesta (200 OK):\*\*  
\`\`\`json  
{  
  "2023": {  
    "1": 17.42,  
    "2": 25.76,  
    "3-7": 53.03,  
    "8-14": 1.52,  
    "15+": 2.27  
  },  
  "2025": {  
    "1": 0,  
    "2": 0,  
    "3-7": 100,  
    "8-14": 0,  
    "15+": 0  
  }  
}  
\`\`\`

\*\*Ejemplo cURL:\*\*  
\`\`\`bash  
curl \--location 'https://app.otasync.me/api/statistics/data/average\_night' \\  
\--  
