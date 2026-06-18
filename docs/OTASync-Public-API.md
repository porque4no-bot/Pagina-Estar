# OTASync Public API

> Documentación generada a partir de la colección pública de Postman de OTASync.

| Campo | Valor |
| --- | --- |
| Base URL | `https://app.otasync.me` |
| Endpoints | 136 |
| Fecha de publicación | 2025-02-04 |
| Fuente | [Postman Documenter](https://documenter.getpostman.com/view/41568417/2sAYX5MNgD) |

## Índice

- [Auth](#auth)
- [Availability](#availability)
- [Boards](#boards)
- [Calendar](#calendar)
- [Channels](#channels)
- [City taxes](#city-taxes)
- [Contact](#contact)
- [Extras](#extras)
- [Guests](#guests)
- [Prices](#prices)
- [Pricing plans](#pricing-plans)
- [Property](#property)
- [Restriction plans](#restriction-plans)
- [Restrictions](#restrictions)
- [Rooms](#rooms)
- [Policies](#policies)
- [Webhooks](#webhooks)
- [Statistics](#statistics)
- [Invoices](#invoices)
- [Engine](#engine)
- [Reviews](#reviews)
- [Notifications](#notifications)
- [E - turista](#e---turista)
- [Montenegro guest](#montenegro-guest)
- [New reservations](#new-reservations)
- [Inventory](#inventory)
- [Banquet](#banquet)
- [Evisitor](#evisitor)
- [Companies](#companies)

---

## Auth <a id="auth"></a>

### Login <a id="login"></a>

`POST` `https://app.otasync.me/api/user/auth/login`

**Login Request**

This is an HTTP POST request to login to the application at [https://app.otasync.me/api/user/auth/login](https://app.otasync.me/api/user/auth/login). The request body is in raw format and includes the following parameters:

- `token` (string): A long token for authentication.
- `username` (string): The username for login.
- `password` (string): The password for login.
- `remember` (number): Indicates whether to remember the login session.

**Response**

Upon successful login, the response returns a status code of 200 and the content type is `text/html`. The response body contains user information including `id_users`, `id_parent`, `status`, `username`, `pwd`, `name`, `email`, `phone`, `address`, `city`, `zip`, `company`, `country`, and more. Additionally, the response includes a list of properties accessible by the user in the `properties` field, and the `pkey` key in the `userInf` field is used as authorization for all other requests.

To obtain the username and password, users can create their property by visiting [https://app.otasync.me/register/](https://app.otasync.me/register/). For the token, users are advised to contact the support team at [https://otasync.me/api.php#connectivityPartner](https://otasync.me/api.php#connectivityPartner).

This HTTP POST request is used to authenticate the user and obtain access to the application.

**Request Body**

- `token` (text): The authentication token obtained from the user.
- `username` (text): The username of the user.
- `password` (text): The password of the user.
- `remember` (text): Indicates whether the user wants to be remembered.

**Response**

Upon successful authentication, the response will contain a status code of 200 and a content type of text/html. The response body includes the user's information such as `id_users`, `id_parent`, `status`, `username`, `pwd`, `name`, `email`, `phone`, `address`, and more. Additionally, the response includes a list of properties accessible by the user under the `properties` field, with each property containing `name` and `id_properties`.

The `pkey` field in the `userInf` section is used as authorization for all subsequent requests.

To obtain your username and password, please create your property by visiting [https://app.otasync.me/register/](https://app.otasync.me/register/). For the authentication token, please contact the support team at [https://otasync.me/api.php#connectivityPartner](https://otasync.me/api.php#connectivityPartner).

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "username": "[YOUR_USERNAME]",
  "password": "[YOUR_PASSWORD]",
  "remember": 0
}
```

**Example response — Login** `200 OK`

```json
{
  "id_users": 50199,
  "id_parent": 0,
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
  "undo_timer": 60,
  "notify_overbooking": 0,
  "notify_new_reservations": 0,
  "notify_for_new_properties_or_units_added": 1,
  "id_users_access_groups": 0,
  "created_by": 0,
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
  "changelog": 3,
  "articles": 3,
  "storn_invoice": 3,
  "reports": 3,
  "allow_add_properties": 1,
  "expenses": 3,
  "omni_channel": 1,
  "inventory": 1,
  "engine": 3,
  "settings": "3",
  "contigents": 0,
  "show_overbookings_and_unassigned_reservations": 1,
  "guest_check_out_invoice": "none",
  "undo_timer_account": "60",
  "theme": null,
  "default_language_account": "rs",
  "company_address": null,
  "send_email_in_case_of_overbooking": "1",
  "show_company_address_on_invoice": null,
  "send_email_for_new_reservations": "1",
  "send_offer_reminder_to_user": 1,
  "send_email_to_guests": null,
  "wubook_connected": -1,
  "bnovo_connected": 0,
  "channex_connected": 0,
  "last_activity": "2025-02-07 15:45:01",
  "phone_verified": 1,
  "email_verified": 0,
  "enable_2fa": 1,
  "2fa_type": "phone",
  "suspended": 0,
  "monthly_price": 0,
  "source": "web",
  "agency": 0,
  "agency_commission": 0,
  "registration_number": null,
  "user_without_email": 0,
  "id_resellers": null,
  "create_channex_group": 0,
  "id_channex_groups": "",
  "subscription_end_date": "2024-12-01",
  "type": "standard",
  "onboarded": 0,
  "is_dummy": 1,
  "payment_required": 1,
  "number_of_units": 5,
  "disable_credit_card": 0,
  "suspened": 0,
  "hear_about_us": "",
  "notes": null,
  "birth": null,
  "package": "no_selected",
  "allow_add_users": 1,
  "delete_reservation": 1,
  "onboarded_by_role": null,
  "onboarded_by_role_id": null,
  "is_deleted": 0,
  "date_deleted": null,
  "date_modified": "2025-02-07 15:45:01",
  "date_created": "2024-11-17 22:23:58",
  "pkey": "aef67742d092b285bb81e9ee65c17e0e884371fd",
  "properties": [
    {
      "name": "Oasis",
      "id_properties": "6577"
    },
    {
      "name": "Fares",
      "id_properties": "6579"
    },
    {
      "name": "Sokratis",
      "id_properties": "7099"
    }
  ]
}
```

---

### Logout <a id="logout"></a>

`POST` `https://app.otasync.me/api/user/auth/logout`

**HTTP POST /api/user/auth/logout**

This endpoint is used to log out a user and remove the key from the database, making it unusable for future requests.

**Request Body**

- key (string, required): The key to be removed from the database.

**Response**

The response for this request does not contain a body.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "key": "0188a6b40ef1240b94b01825ba38fab4043adb0f"
}
```

**Example response — Logout** `204 No Content`

_(empty response body)_

---

### One Signal player ID <a id="one-signal-player-id"></a>

`POST` `https://app.otasync.me/api/user/edit/one_signal`

**Edit One Signal User**

This endpoint allows the user to edit the One Signal user details.

**Request**

- Method: POST
- URL: `https://app.otasync.me/api/user/edit/one_signal`
- Body:
  - key (text, required): The user's One Signal API key.
  - player_id (text, required): The unique player ID.

**Response**

The response for this request is a JSON schema. The schema includes the structure and data types of the response body, but specific values are not provided for privacy reasons.

**Request body** (`raw`)

```json
{
  "key": "97d3e00461337d64b0ef1463193451a355ad8c71",
  "player_id": "321"
}
```

---

## Availability <a id="availability"></a>

### Get availability <a id="get-availability"></a>

`POST` `https://app.otasync.me/api/avail/data/avail`

**POST /api/avail/data/avail**

This endpoint is used to retrieve the availability of each room type for the specified date range.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_properties` (number): The ID of the properties.
- `dfrom` (string): The start date of the date range in the format 'YYYY-MM-DD'.
- `dto` (string): The end date of the date range in the format 'YYYY-MM-DD'.

**Response**

The response will contain the availability of each room type for the specified date range in the format 'id_room_types' => 'date' => 'value'.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "dfrom": "2022-05-21",
  "dto": "2022-05-21"
}
```

**Example response — Get availability** `200 OK`

```json
{
  "172": {
    "2022-05-21": "31"
  },
  "174": {
    "2022-05-21": "1"
  },
  "175": {
    "2022-05-21": "1"
  },
  "4351": {
    "2022-05-21": "2"
  },
  "4352": {
    "2022-05-21": "2"
  },
  "4429": {
    "2022-05-21": "1"
  },
  "4974": {
    "2022-05-21": "1"
  },
  "6396": {
    "2022-05-21": "2"
  },
  "6397": {
    "2022-05-21": "2"
  },
  "6400": {
    "2022-05-21": "2"
  },
  "6405": {
    "2022-05-21": "2"
  },
  "6413": {
    "2022-05-21": "2"
  },
  "6415": {
    "2022-05-21": "2"
  },
  "6416": {
    "2022-05-21": "2"
  },
  "6418": {
    "2022-05-21": "2"
  },
  "6419": {
    "2022-05-21": "2"
  },
  "6420": {
    "2022-05-21": "2"
  },
  "6421": {
    "2022-05-21": "2"
  },
  "6422": {
    "2022-05-21": "2"
  },
  "6423": {
    "2022-05-21": "2"
  },
  "6424": {
    "2022-05-21": "2"
  },
  "6432": {
    "2022-05-21": "2"
  },
  "6433": {
    "2022-05-21": "2"
  },
  "6434": {
    "2022-05-21": "2"
  },
  "6435": {
    "2022-05-21": "2"
  },
  "6436": {
    "2022-05-21": "2"
  },
  "6439": {
    "2022-05-21": "2"
  },
  "6440": {
    "2022-05-21": "2"
  },
  "6441": {
    "2022-05-21": "2"
  },
  "6442": {
    "2022-05-21": "2"
  },
  "6443": {
    "2022-05-21": "2"
  },
  "6444": {
    "2022-05-21": "2"
  },
  "6445": {
    "2022-05-21": "2"
  },
  "6446": {
    "2022-05-21": "2"
  },
  "7379": {
    "2022-05-21": "2"
  },
  "7380": {
    "2022-05-21": "2"
  },
  "12699": {
    "2022-05-21": "2"
  },
  "13507": {
    "2022-05-21": "2"
  },
  "13512": {
    "2022-05-21": "5"
  },
  "13513": {
    "2022-05-21": "11"
  },
  "16473": {
    "2022-05-21": "10"
  }
}
```

---

### Edit availability <a id="edit-availability"></a>

`POST` `https://app.otasync.me/api/avail/edit/avail`

**Update Availability**

Updates the availability of room types.

**Request Body**

- token (string): The authentication token.
- key (string): The key for authentication.
- id_properties (number): The ID of the property.
- dfrom (string): The start date for availability update (YYYY-MM-DD).
- dto (string): The end date for availability update (YYYY-MM-DD).
- rooms (array of objects): An array of objects, each containing the ID of the room type and the value.
  - id_room_types (number): The ID of the room type.
  - value (number): The availability value.
- variation_type (number):
  - -1: Decreases availability by the sent value.
  - 0: Sets the availability to the sent value.
  - 1: Increases availability by the sent value.
- weekdays (array of numbers, optional): An array of 7 values (1 or 0), which indicates which days of the week will be updated (Starting from Sunday).

**Response (JSON Schema)**

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  }
}
```

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "dfrom": "2025-03-01",
  "dto": "2025-04-10",
  "rooms": [
    {
      "id_room_types": 170,
      "value": 2
    }
  ],
  "variation_type": 0,
  "weekdays": [
    1,
    1,
    1,
    1,
    1,
    1,
    1
  ]
}
```

**Example response — Edit availability** `200 OK`

```json
{
  "id_changelog": 12197508,
  "old_values": [],
  "new_values": [],
  "warnings": []
}
```

---

## Boards <a id="boards"></a>

### Get boards <a id="get-boards"></a>

`POST` `https://app.otasync.me/api/boards/data/boards`

**Request**

This endpoint makes an HTTP POST request to retrieve a list of all Boards for the property. The request body should be in raw format and include the following parameters:

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_properties` (number): The ID of the property.

Example request body:

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdc ...",
  "key": "574eb98879eb28d03b21e8a5c1a212 ...",
  "id_properties": 93
}
```

**Response**

The response will be a JSON object with a schema similar to the following:

```json
{
  "boards": [
    {
      "id": "1",
      "name": "Breakfast",
      "price": {
        "adult": 100,
        "child": 50
      }
    },
    {
      "id": "2",
      "name": "Lunch",
      "price": {
        "adult": 120,
        "child": 60
      }
    },
    ...
  ]
}
```

The `boards` array contains objects with the following properties:

- `id` (string): The ID of the board.
- `name` (string): The name of the board.
- `price` (object): The price for each guest category, containing `adult` and `child` prices.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93
}
```

**Example response — Get boards** `200 OK`

```json
[
  {
    "id_properties": 93,
    "id_boards": 837,
    "id_board_names": 9,
    "name": "Room only",
    "price_children_1": 5,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": 0,
    "price_children_5": 0,
    "price_children_6": 0,
    "price_children_7": 0,
    "price_adults": 10,
    "price_seniors": 0,
    "date_created": "2021-05-06 11:08:33",
    "first_meal": ""
  },
  {
    "id_properties": 93,
    "id_boards": 836,
    "id_board_names": 8,
    "name": "All Inclusive",
    "price_children_1": 5,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": 0,
    "price_children_5": 0,
    "price_children_6": 0,
    "price_children_7": 0,
    "price_adults": 10,
    "price_seniors": 0,
    "date_created": "2021-05-06 11:08:33",
    "first_meal": ""
  },
  {
    "id_properties": 93,
    "id_boards": 835,
    "id_board_names": 7,
    "name": "Fullboard",
    "price_children_1": 0,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": 0,
    "price_children_5": 0,
    "price_children_6": 0,
    "price_children_7": 0,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-05-06 11:08:33",
    "first_meal": "breakfast"
  },
  {
    "id_properties": 93,
    "id_boards": 834,
    "id_board_names": 6,
    "name": "Breakfast-Dinner",
    "price_children_1": 0,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": 0,
    "price_children_5": 0,
    "price_children_6": 0,
    "price_children_7": 0,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-05-06 11:08:33",
    "first_meal": "breakfast"
  },
  {
    "id_properties": 93,
    "id_boards": 833,
    "id_board_names": 5,
    "name": "Breakfast-Lunch",
    "price_children_1": 5,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": 0,
    "price_children_5": 0,
    "price_children_6": 0,
    "price_children_7": 0,
    "price_adults": 10,
    "price_seniors": 0,
    "date_created": "2021-05-06 11:08:33",
    "first_meal": ""
  },
  {
    "id_properties": 93,
    "id_boards": 832,
    "id_board_names": 4,
    "name": "Lunch-Dinner",
    "price_children_1": 0,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": 0,
    "price_children_5": 0,
    "price_children_6": 0,
    "price_children_7": 0,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-05-06 11:08:33",
    "first_meal": "lunch"
  },
  {
    "id_properties": 93,
    "id_boards": 831,
    "id_board_names": 3,
    "name": "Dinner",
    "price_children_1": 0,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": 0,
    "price_children_5": 0,
    "price_children_6": 0,
    "price_children_7": 0,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-05-06 11:08:33",
    "first_meal": ""
  },
  {
    "id_properties": 93,
    "id_boards": 830,
    "id_board_names": 2,
    "name": "Lunch",
    "price_children_1": 0,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": 0,
    "price_children_5": 0,
    "price_children_6": 0,
    "price_children_7": 0,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-05-06 11:08:33",
    "first_meal": ""
  },
  {
    "id_properties": 93,
    "id_boards": 829,
    "id_board_names": 1,
    "name": "Breakfast",
    "price_children_1": 60,
    "price_children_2": 84,
    "price_children_3": 0,
    "price_children_4": 0,
    "price_children_5": 0,
    "price_children_6": 0,
    "price_children_7": 0,
    "price_adults": 120,
    "price_seniors": 120,
    "date_created": "2021-05-06 11:08:33",
    "first_meal": ""
  }
]
```

---

### Update boards prices <a id="update-boards-prices"></a>

`POST` `https://app.otasync.me/api/boards/edit/boards`

**Update Boards Prices**

Updates prices for multiple boards at the same time.

**Request Body**

- token (string): The authentication token.
- key (string): The unique key for the request.
- id_properties (number): The ID of the properties.
- boards (array):
  - price_children_1 (number): The price for children category 1.
  - price_children_2 (number): The price for children category 2.
  - price_children_3 (number): The price for children category 3.
  - price_adults (number): The price for adults.
  - price_seniors (number): The price for seniors.
  - id_board_names (number): The ID of the board name. (Refer to the provided IDs for reference)

**Response**

```json
{
  "status": "string",
  "message": "string",
  "data": "object"
}
```

The response includes a status message, a descriptive message, and the data object.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "boards": [
    {
      "price_children_1": 5,
      "price_children_2": 0,
      "price_children_3": 0,
      "price_adults": 10,
      "price_seniors": 0,
      "id_board_names": 1
    },
    {
      "price_children_1": 50,
      "price_children_2": 0,
      "price_children_3": 0,
      "price_adults": 50,
      "price_seniors": 0,
      "id_board_names": 2
    },
    {
      "price_children_1": 10,
      "price_children_2": 10,
      "price_children_3": 10,
      "price_adults": 10,
      "price_seniors": 10,
      "id_board_names": 3
    }
  ]
}
```

**Example response — Update boards prices** `204 No Content`

_(empty response body)_

---

## Calendar <a id="calendar"></a>

### Get calendar <a id="get-calendar"></a>

`POST` `https://app.otasync.me/api/calendar/data/calendar`

**POST /api/calendar/data/calendar**

This endpoint is used to retrieve calendar data.

**Request Body**

- token (string): The authentication token for accessing the calendar data.
- key (string): The key for accessing the calendar data.
- id_properties (integer): The ID of the properties for which the calendar data is being retrieved.
- date (string): The date for which the calendar data is being retrieved.
- id_pricing_plans (integer): The ID of the pricing plans associated with the calendar data.
- id_restriction_plans (integer): The ID of the restriction plans associated with the calendar data.
- avail (integer): The availability status for the specified date.
- price (integer): The price for the specified date.
- min (integer): The minimum value for the specified date.
- days (integer): The number of days for which the calendar data is being retrieved.
- scroll (integer): The scroll value for the calendar data.
- type (string): The type of calendar data being retrieved.

**Response**

The response for this request will be a JSON object representing the calendar data, following the schema provided by the user.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "date": "2022-04-17",
  "id_pricing_plans": 373,
  "id_restriction_plans": 195,
  "avail": 1,
  "price": 1,
  "min": 1,
  "days": 2,
  "scroll": 0,
  "type": "compact"
}
```

**Example response — Get calendar** `200 OK`

```json
{
  "property": {
    "name": "Europa Royale Bucharest",
    "currency": "EUR"
  },
  "filters": {
    "default_price": "11029",
    "default_restriction": 193,
    "id_calendar_settings": 85,
    "id_properties": 93,
    "id_users": 7,
    "avail": 1,
    "price": 1,
    "min": 0,
    "margin": 0,
    "reservation_position": "center",
    "room_name": 1,
    "room_type": 1,
    "room_status": 1,
    "days": "14",
    "type": "room_types",
    "scroll": 1,
    "row_height": "large",
    "color": "guest_status",
    "autosave": 1,
    "collapse": 0,
    "compact": 0,
    "weekends": "sat-sun",
    "occupancy_room_types": 0,
    "occupancy_total": 1,
    "group_by_floors": 0,
    "dfrom": "2022-04-17",
    "dto": "2022-04-19",
    "rooms": [
      {
        "id_rooms": "41596",
        "id_room_types": "16473",
        "name": "A",
        "status": "clean",
        "is_deleted": "0",
        "date_deleted": null,
        "room_date_created": "2024-07-04 15:08:44",
        "shortname": "MARS",
        "room_type_name": "MARS",
        "num": null,
        "visible": null,
        "occupancy": "3",
        "avail": "10",
        "id_properties": "93"
      },
      {
        "id_rooms": "41597",
        "id_room_types": "16473",
        "name": "B",
        "status": "clean",
        "is_deleted": "0",
        "date_deleted": null,
        "room_date_created": "2024-07-04 15:08:44",
        "shortname": "MARS",
        "room_type_name": "MARS",
        "num": null,
        "visible": null,
        "occupancy": "3",
        "avail": "10",
        "id_properties": "93"
      },
      {
        "id_rooms": "41598",
        "id_room_types": "16473",
        "name": "",
        "status": "clean",
        "is_deleted": "0",
        "date_deleted": null,
        "room_date_created": "2024-07-04 15:08:44",
        "shortname": "MARS",
        "room_type_name": "MARS",
        "num": null,
        "visible": null,
        "occupancy": "3",
        "avail": "10",
        "id_properties": "93"
      },
      {
        "id_rooms": "41599",
        "id_room_types": "16473",
        "name": "",
        "status": "clean",
        "is_deleted": "0",
        "date_deleted": null,
        "room_date_created": "2024-07-04 15:08:44",
        "shortname": "MARS",
        "room_type_name": "MARS",
        "num": null,
        "visible": null,
        "occupancy": "3",
        "avail": "10",
        "id_properties": "93"
      },
      {
        "id_rooms": "41600",
        "id_room_types": "16473",
        "name": "",
        "status": "clean",
        "is_deleted": "0",
        "date_deleted": null,
        "room_date_created": "2024-07-04 15:08:44",
        "shortname": "MARS",
        "room_type_name": "MARS",
        "num": null,
        "visible": null,
        "occupancy": "3",
        "avail": "10",
        "id_properties": "93"
      },
      {
        "id_rooms": "41601",
        "id_room_types": "16473",
        "name": "",
        "status": "clean",
        "is_deleted": "0",
        "date_deleted": null,
        "room_date_created": "2024-07-04 15:08:44",
        "shortname": "MARS",
        "room_type_name": "MARS",
        "num": null,
        "visible": null,
        "occupancy": "3",
        "avail": "10",
        "id_properties": "93"
      },
      {
        "id_rooms": "41602",
        "id_room_types": "16473",
        "name": "",
        "status": "clean",
        "is_deleted": "0",
        "date_deleted": null,
        "room_date_created": "2024-07-04 15:08:44",
        "shortname": "MARS",
        "room_type_name": "MARS",
        "num": null,
        "visible": null,
        "occupancy": "3",
        "avail": "10",
        "id_properties": "93"
      },
      {
        "id_rooms": "41603",
        "id_room_types": "16473",
        "name": "",
        "status": "clean",
        "is_deleted": "0",
        "date_deleted": null,
        "room_date_created": "2024-07-04 15:08:44",
        "shortname": "MARS",
        "room_type_name": "MARS",
        "num": null,
        "visible": null,
        "occupancy": "3",
        "avail": "10",
        "id_properties": "93"
      },
      {
        "id_rooms": "41604",
        "id_room_types": "16473",
        "name": "",
        "status": "clean",
        "is_deleted": "0",
        "date_deleted": null,
        "room_date_created": "2024-07-04 15:08:44",
        "shortname": "MARS",
        "room_type_name": "MARS",
        "num": null,
        "visible": null,
        "occupancy": "3",
        "avail": "10",
        "id_properties": "93"
      },
      {
        "id_rooms": "41605",
        "id_room_types": "16473",
        "name": "",
        "status": "clean",
        "is_deleted": "0",
        "date_deleted": null,
        "room_date_created": "2024-07-04 15:08:44",
        "shortname": "MARS",
        "room_type_name": "MARS",
        "num": null,
        "visible": null,
        "occupancy": "3",
        "avail": "10",
        "id_properties": "93"
      },
      {
        "id_rooms": "15472",
        "id_room_types": "6396",
        "name": "A",
        "status": "clean",
        "is_deleted": "0",
        "date_deleted": null,
        "room_date_created": "2023-05-11 16:42:07",
        "shortname": "TR3",
        "room_type_name": "Test Room 3",
        "num": "1",
        "visible": "1",
        "occupancy": "3",
        "avail": "2",
        "id_properties": "93"
      },
      {
        "id_rooms": "15473",
        "id_room_types": "6396",
        "name": "B",
        "status": "clean",
        "is_deleted": "0",
        "date_deleted": null,
        "room_date_created": "2023-05-11 16:42:07",
        "shortname": "TR3",
        "room_type_name": "Test Room 3",
        "num": "2",
        "visible": "1",
        "occupancy": "3",
        "avail": "2",
        "id_properties": "93"
      },
      {
        "id_rooms": "15474",
        "id_room_types": "6397",
        "name": "A",
        "status": "clean",
        "is_deleted": "0",
        "
```

_(response truncated — original length 375.842 characters)_

---

### Edit dates <a id="edit-dates"></a>

`POST` `http://localhost/otasync-db/api/calendar/edit/dates`

**Edit Calendar Dates**

This endpoint allows the user to edit calendar dates for a specific property, pricing plan, and restriction plan.

**Request**

- Method: POST
- URL: `http://localhost/otasync-db/api/calendar/edit/dates`
- Body:
  - key (text, required): The authentication key for accessing the API.
  - id_properties (integer, required): The ID of the property for which the calendar dates are being edited.
  - id_pricing_plans (integer, required): The ID of the pricing plan to be associated with the edited dates.
  - id_restriction_plans (integer, required): The ID of the restriction plan to be applied to the edited dates.
  - values (array, required): An array of objects containing the following properties:
    - date (string, required): The date to be edited in the format 'YYYY-MM-DD'.
    - avail (integer, required): The availability status for the specified date.
    - price (integer, required): The price for the specified date.
    - id_room_types (integer, required): The ID of the room type associated with the specified date.
    - closed (integer, required): The closure status for the specified date.

**Response**

The response for this request will be a JSON object conforming to the following schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  }
}
```

The response will contain a `status` field indicating the status of the request, and a `message` field providing additional information about the request status.

**Request body** (`raw`)

```json
{
  "key": "306000f2486020321dd19ef9c25b13a3af4bad2b",
  "id_properties": 10,
  "id_pricing_plans": 13,
  "id_restriction_plans": 5,
  "values": [
    {
      "date": "2024-10-07",
      "avail": 0,
      "price": 88,
      "id_room_types": 29,
      "closed": 1
    },
    {
      "date": "2024-10-08",
      "avail": 0,
      "price": 87,
      "id_room_types": 29,
      "closed": 1
    },
    {
      "date": "2024-10-09",
      "avail": 0,
      "price": 87,
      "id_room_types": 29,
      "closed": 1
    }
  ]
}
```

---

## Channels <a id="channels"></a>

### Get channels <a id="get-channels"></a>

`POST` `https://beta.otasync.me/api/channels/data/channels`

**Request**

This API endpoint makes an HTTP POST request to [https://beta.otasync.me/api/channels/data/channels](https://beta.otasync.me/api/channels/data/channels) to retrieve a list of all channels for the property. The request body is in raw format and includes the following parameters:

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_properties` (number): The ID of the properties.

**Response**

The response returned is in JSON format and represents a list of channels for the property. Here is the JSON schema for the response:

```json
[
  {
    "id_properties": "number",
    "id_channels": "number",
    "name": "string",
    "commission": "number",
    "logo": "string",
    "type": "string",
    "hotel_id": "string",
    "date_created": "string",
    "tax": "number",
    "channex_ch_id": "string"
  }
]
```

The HTTP status of the response is 200, and the content type is text/html.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93
}
```

**Example response — Get channels** `200 OK`

```json
[
  {
    "id_properties": 93,
    "id_channels": 392,
    "name": "Private reservation",
    "commission": 0,
    "logo": "https://app.otasync.me/img/ota/youbook.png",
    "type": "Private reservation",
    "hotel_id": "",
    "date_created": "2021-05-06 11:08:33",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 393,
    "name": "Booking engine",
    "commission": 0,
    "logo": "https://app.otasync.me/img/ota/ota_b.png",
    "type": "Booking engine",
    "hotel_id": "",
    "date_created": "2021-05-06 11:08:33",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 395,
    "name": "Airbnb",
    "commission": 15,
    "logo": "https://wubook.net/imgs/default/channels_airbnb.png",
    "type": "Airbnb",
    "hotel_id": "",
    "date_created": "2021-05-06 11:08:35",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 396,
    "name": "Expedia",
    "commission": 18,
    "logo": "https://app.otasync.me/images/channel_544.gif",
    "type": "Expedia",
    "hotel_id": "",
    "date_created": "2021-05-06 11:08:35",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 397,
    "name": "Ostrovok",
    "commission": 18,
    "logo": "https://wubook.net/imgs/default/channels_ostrovok.png",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2021-05-06 11:08:35",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 398,
    "name": "SunHotels",
    "commission": 0,
    "logo": "https://app.otasync.me/img/ota/sunhotels.png",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2021-05-06 11:08:35",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 399,
    "name": "test",
    "commission": 0,
    "logo": "https://admin.otasync.me//images/1521199571_1605770977.jpg",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2021-05-06 11:08:35",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 400,
    "name": "test23",
    "commission": 20,
    "logo": "https://admin.otasync.me//images/1521199571_1605864535.jpeg",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2021-05-06 11:08:35",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 2100,
    "name": "Bits",
    "commission": 2,
    "logo": "",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2021-09-24 22:34:25",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 2303,
    "name": "Kanal",
    "commission": 0,
    "logo": "",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2021-10-14 13:16:33",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 2379,
    "name": "TestKanal",
    "commission": 0,
    "logo": "",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2021-10-22 17:27:37",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 2380,
    "name": "TestKanal",
    "commission": 0,
    "logo": "",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2021-10-22 17:28:26",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 2381,
    "name": "TestKanalLaravel",
    "commission": 0,
    "logo": "",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2021-10-22 17:33:16",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 2385,
    "name": "TestKanalLaravel",
    "commission": 0,
    "logo": "",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2021-10-23 19:24:22",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 4813,
    "name": "New channel",
    "commission": 10,
    "logo": "",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2022-04-18 15:24:14",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 6448,
    "name": "Postman API",
    "commission": 0,
    "logo": "",
    "type": "Partner channel",
    "hotel_id": "",
    "date_created": "2022-07-21 16:35:04",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 6499,
    "name": "NomadStays",
    "commission": 0,
    "logo": "",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2022-07-26 08:23:21",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 6550,
    "name": "NomadStays",
    "commission": 0,
    "logo": "https://app.otasync.me/images/partner_14.png",
    "type": "Partner channel",
    "hotel_id": "",
    "date_created": "2022-08-02 10:57:29",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 12237,
    "name": "New channel",
    "commission": 10,
    "logo": "",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2023-07-06 15:06:13",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 12238,
    "name": "New channel",
    "commission": 10,
    "logo": "",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2023-07-06 15:07:18",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 12239,
    "name": "New channel",
    "commission": 10,
    "logo": "",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2023-07-06 15:09:29",
    "tax": 0,
    "channex_ch_id": null
  },
  {
    "id_properties": 93,
    "id_channels": 12242,
    "name": " ",
    "commission": 10,
    "logo": "",
    "type": "Custom channel",
    "hotel_id": "",
    "date_created": "2023-07-06 15:17:08",
    "tax": 0
```

_(response truncated — original length 8.420 characters)_

---

### Get channel <a id="get-channel"></a>

`POST` `https://app.otasync.me/api/channels/data/channel`

**POST /api/channels/data/channel**

Creates a new channel with the provided information.

**Request Body**

- raw (application/json)
  - token: string (required) - The authentication token
  - key: string (required) - The key
  - id_properties: number (required) - The ID of properties
  - id_channels: number (required) - The ID of the channel

**Response**

The response of this request is a JSON schema representing the information of the created channel.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_channels": 4814
}
```

**Example response — Get channel** `200 OK`

```json
{
  "pricing_plans": []
}
```

---

### Insert channel <a id="insert-channel"></a>

`POST` `https://app.otasync.me/api/channels/insert/channel`

**Request**

This API endpoint is used to insert a new channel. The request should be sent as an HTTP POST to `https://app.otasync.me/api/channels/insert/channel`.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_properties` (number): The ID properties for the new channel.
- `name` (string): The name of the new channel.
- `commission` (number): The commission for the new channel.

**Response**

The response for this request is a JSON object with the following schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "channel_id": {
          "type": "number"
        }
      }
    }
  }
}
```

The response includes a `status` field indicating the status of the request, a `message` field with additional information, and a `data` field containing the `channel_id` of the newly inserted channel.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "name": "New channel",
  "commission": 10
}
```

**Example response — Insert channel** `201 Created`

```json
{
  "id_channels": 43826,
  "id_changelog": 12197602
}
```

---

### Edit channel <a id="edit-channel"></a>

`POST` `https://app.otasync.me/api/channels/edit/channel`

**Edit Channel**

HTTP POST request to edit a channel in the OTAsync application.

**Request Body**

- token (text, required): The authentication token for the user.
- key (text, required): The key for the channel.
- id_properties (text, required): The ID of the properties.
- id_channels (text, required): The ID of the channel.
- name (text, required): The name to be edited.
- commission (text, required): The commission for the channel.

**Response**

The response for this request is a JSON object with the following schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  }
}
```

Returns the status and a message indicating the result of the channel edit operation.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_channels": 4814,
  "name": "Edit name",
  "commission": 2
}
```

**Example response — Edit channel** `200 OK`

```json
{
  "id_channels": 4814,
  "id_changelog": 12197759
}
```

---

### Delete channel <a id="delete-channel"></a>

`POST` `https://app.otasync.me/api/channels/delete/channel`

**Delete Channel**

This endpoint is used to delete a specific channel.

**Request Body**

- `token` (string): The authentication token.
- `key` (string): The key for authentication.
- `id_properties` (integer): The ID of the properties.
- `id_channels` (integer): The ID of the channel to be deleted.

**Response Body**

The response will not contain a request body.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_channels": 4814
}
```

**Example response — Delete channel** `200 OK`

```json
{
  "code": 200,
  "id_channels": 4814,
  "id_changelog": 12197764
}
```

---

## City taxes <a id="city-taxes"></a>

### Get city taxes <a id="get-city-taxes"></a>

`POST` `https://app.otasync.me/api/cityTax/data/city_taxes`

**Create City Taxes Data**

This endpoint allows you to retrieve a list of all City Taxes for the specified property.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_properties` (integer): The ID of the property for which the City Taxes data is being retrieved.

Example:

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdc ...",
  "key": "574eb98879eb28d03b21e8a5c1a212 ...",
  "id_properties": 93
}
```

**Response**

The response will contain a list of City Taxes for the specified property. Each city tax includes the price for each guest category and an active period defined by "dfrom" and "dto". If "dfrom" and "dto" are set to "0001-01-01", the city tax is active for all dates. The "tax_included" field indicates whether the city tax price will be deducted from the reservation room price when adding the city tax to the reservation. If "tax_included" is set to "yes", the city tax price will be deducted; otherwise, it will be added to the total reservation price.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93
}
```

**Example response — Get city taxes** `200 OK`

```json
[
  {
    "id_properties": 93,
    "id_city_taxes": 1,
    "name": "Cleaning fee",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "no",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 0,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 10,
    "price_seniors": 0,
    "date_created": "2021-05-09 08:03:22",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 2,
    "name": "Transfer airport",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "no",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 0,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-05-09 08:04:13",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 3,
    "name": "Extra cleaning fee",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "no",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 0,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-05-09 08:04:30",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 10,
    "name": "Boravisna Taksa",
    "dfrom": "0001-01-01",
    "dto": "0001-01-01",
    "tax_included": "no",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 60,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 120,
    "price_seniors": 0,
    "date_created": "2021-06-04 12:05:44",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 178,
    "name": "Tax with insurance",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "yes",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 2.333,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 2.65,
    "price_seniors": 0,
    "date_created": "2021-10-14 12:50:56",
    "use_insurance": 1
  },
  {
    "id_properties": 93,
    "id_city_taxes": 251,
    "name": "Test",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "yes",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 10,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-11-04 12:41:25",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 252,
    "name": "Test",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "yes",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 10,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-11-04 12:42:13",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 253,
    "name": "Test",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "yes",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 10,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-11-05 13:02:53",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 254,
    "name": "Test",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "yes",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 10,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-11-05 13:03:28",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 257,
    "name": "Test",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "yes",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 10,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
```

_(response truncated — original length 7.897 characters)_

---

### Get city tax <a id="get-city-tax"></a>

`POST` `https://app.otasync.me/api/cityTax/data/city_taxes`

**POST City Taxes Data**

Returns city tax information.

**Request Body**

- token (text, required): The authentication token.
- key (text, required): The key for accessing the data.
- id_city_taxes (text, required): The ID of the city taxes.
- id_properties (text, required): The ID of the properties.

**Response Body**

The response contains the city tax information.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_city_taxes": 1,
  "id_properties": 93
}
```

**Example response — Get city tax** `200 OK`

```json
[
  {
    "id_properties": 93,
    "id_city_taxes": 1,
    "name": "Cleaning fee",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "no",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 0,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 10,
    "price_seniors": 0,
    "date_created": "2021-05-09 08:03:22",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 2,
    "name": "Transfer airport",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "no",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 0,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-05-09 08:04:13",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 3,
    "name": "Extra cleaning fee",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "no",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 0,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-05-09 08:04:30",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 10,
    "name": "Boravisna Taksa",
    "dfrom": "0001-01-01",
    "dto": "0001-01-01",
    "tax_included": "no",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 60,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 120,
    "price_seniors": 0,
    "date_created": "2021-06-04 12:05:44",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 178,
    "name": "Tax with insurance",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "yes",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 2.333,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 2.65,
    "price_seniors": 0,
    "date_created": "2021-10-14 12:50:56",
    "use_insurance": 1
  },
  {
    "id_properties": 93,
    "id_city_taxes": 251,
    "name": "Test",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "yes",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 10,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-11-04 12:41:25",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 252,
    "name": "Test",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "yes",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 10,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-11-04 12:42:13",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 253,
    "name": "Test",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "yes",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 10,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-11-05 13:02:53",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 254,
    "name": "Test",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "yes",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 10,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
    "price_seniors": 0,
    "date_created": "2021-11-05 13:03:28",
    "use_insurance": 0
  },
  {
    "id_properties": 93,
    "id_city_taxes": 257,
    "name": "Test",
    "dfrom": "2021-05-01",
    "dto": "2021-12-31",
    "tax_included": "yes",
    "calculate_per_guest": 1,
    "same_price_for_all_room_types": 1,
    "price_rooms": 0,
    "price_percent_of_room_price": 0,
    "price_children_1": 10,
    "price_children_2": 0,
    "price_children_3": 0,
    "price_children_4": null,
    "price_children_5": null,
    "price_children_6": null,
    "price_children_7": null,
    "price_adults": 0,
```

_(response truncated — original length 7.897 characters)_

---

### Delete city tax <a id="delete-city-tax"></a>

`POST` `https://app.otasync.me/api/cityTax/delete/city_tax`

**Request**

- Method: POST
- Endpoint: `https://app.otasync.me/api/cityTax/delete/city_tax`
- Description: Deletes a city tax.
- Body:
  - token (text, required): The authentication token for the request.
  - key (text, required): The key for the request.
  - id_city_taxes (text, required): The ID of the city tax to be deleted.
  - id_properties (text, required): The ID of the properties related to the city tax.

**Response**

- Content Type: application/json
- { "type": "object", "properties": { "status": { "type": "string" }, "message": { "type": "string" } } }

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_city_taxes": 96,
  "id_properties": 93
}
```

**Example response — Delete city tax** `200 OK`

```json
{
  "id_city_taxes": "96",
  "id_changelog": 12197768
}
```

---

### Insert city tax <a id="insert-city-tax"></a>

`POST` `https://app.otasync.me/api/cityTax/insert/city_tax`

**Insert City Tax**

This endpoint allows you to insert a new city tax.

**Request Body**

- token (string): The authentication token for the request.
- key (string): The key for the request.
- id_properties (number): The ID of the properties.
- name (string): The name of the city tax.
- price_children_1 (number): The price for children category 1.
- price_children_2 (number): The price for children category 2.
- price_children_3 (number): The price for children category 3.
- price_adults (number): The price for adults category.
- price_seniors (number): The price for seniors category.
- dfrom (string): The start date for the city tax (format: "YYYY-MM-DD").
- dto (string): The end date for the city tax (format: "YYYY-MM-DD").
- tax_included (string): Indicates if tax is included, can be "yes" or "no".

**Note**

- Prices for unused guest categories should be sent as 0.
- If the city tax is active for all dates, the "dfrom" and "dto" fields should be sent as empty strings ("").

**Response (JSON Schema)**

```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string" },
    "message": { "type": "string" }
  }
}
```

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "name": "Test",
  "price_children_1": 10,
  "price_children_2": 0,
  "price_children_3": 0,
  "price_adults": 0,
  "price_seniors": 0,
  "dfrom": "2025-05-01",
  "dto": "2025-12-31",
  "tax_included": "yes"
}
```

---

### Update city tax <a id="update-city-tax"></a>

`POST` `https://app.otasync.me/api/cityTax/edit/city_tax`

**Update City Tax**

This endpoint allows you to update a city tax with the provided information.

**Request Body**

- `token`: The authentication token for the request.
- `key`: The key for the request.
- `id_properties`: The ID of the properties.
- `name`: The name of the city tax.
- `price_children_1`: The price for children (age group 1).
- `price_children_2`: The price for children (age group 2).
- `price_children_3`: The price for children (age group 3).
- `price_adults`: The price for adults.
- `price_seniors`: The price for seniors.
- `dfrom`: The start date for the city tax.
- `dto`: The end date for the city tax.
- `tax_included`: Indicates if the tax is included (yes/no).
- `id_city_taxes`: The ID of the city tax.

**Response Body**

The response will contain the updated city tax details.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "name": "Test",
  "price_children_1": 10,
  "price_children_2": 0,
  "price_children_3": 0,
  "price_adults": 0,
  "price_seniors": 0,
  "dfrom": "2021-05-01",
  "dto": "2021-12-31",
  "tax_included": "yes",
  "id_city_taxes": 178
}
```

---

## Contact <a id="contact"></a>

### Message <a id="message"></a>

`POST` `https://app.otasync.me/api/contact/message`

**POST /api/contact/message**

This endpoint is used to send a message to a contact.

**Request**

- Method: POST
- URL: `https://app.otasync.me/api/contact/message`
- Headers:
  - Content-Type: application/json
- Body:
  - token (string, required): The authentication token for the user.
  - key (string, required): The key for the message.
  - id_properties (number, required): The ID properties of the contact.
  - subject (string, required): The subject of the email.
  - text (string, required): The text of the email.

**Response**

The response for this request is a JSON object with the following schema:

```json
{
  "status": "string",
  "message": "string"
}
```

- status (string): The status of the response.
- message (string): A message related to the response status.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "subject": "Subject of email",
  "text": "Text of email"
}
```

**Example response — Message** `204 No Content`

_(empty response body)_

---

## Extras <a id="extras"></a>

### Get extras <a id="get-extras"></a>

`POST` `https://app.otasync.me/api/extras/data/extras`

**Request**

- Method: POST
- URL: `https://app.otasync.me/api/extras/data/extras`
- Description: This endpoint is used to retrieve a list of all Extras for the property.
- Payload:
  - token (string): The authentication token for the request.
  - id_properties (number): The ID of the property for which the extras are being retrieved.
  - key (string): The unique key associated with the request.

**Response**

- Content Type: application/json
- Description: This endpoint returns a list of all Extras for the specified property.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "id_properties": 93,
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f"
}
```

**Example response — Get extras** `200 OK`

```json
{
  "extras": [
    {
      "id_properties": "93",
      "id_extras": "4",
      "name": "Doručak",
      "description": "Delicious Breakfast Description.",
      "category": "Mini Bar",
      "price": 500,
      "type": "person",
      "tax": "20",
      "period_type": "period",
      "dfrom": "2021-05-01",
      "dto": "2022-05-11",
      "id_restriction_plans": "0",
      "image": "",
      "use_on_booking_engine": "1",
      "date_created": "2021-05-06 11:37:21",
      "id_extras_category": "6"
    },
    {
      "id_properties": "93",
      "id_extras": "5",
      "name": "Spa Centar",
      "description": "",
      "category": "Mini Bar",
      "price": 1000,
      "type": "person",
      "tax": "20",
      "period_type": "period",
      "dfrom": "2021-04-30",
      "dto": "2022-05-30",
      "id_restriction_plans": "0",
      "image": "",
      "use_on_booking_engine": "0",
      "date_created": "2021-05-06 11:38:07",
      "id_extras_category": "6"
    },
    {
      "id_properties": "93",
      "id_extras": "9",
      "name": "vecera",
      "description": "",
      "category": null,
      "price": 1800,
      "type": "one",
      "tax": "0",
      "period_type": "period",
      "dfrom": "0001-01-01",
      "dto": "0001-01-01",
      "id_restriction_plans": "0",
      "image": "",
      "use_on_booking_engine": "0",
      "date_created": "2021-05-16 11:41:00",
      "id_extras_category": "0"
    },
    {
      "id_properties": "93",
      "id_extras": "13",
      "name": "Extras 1",
      "description": "",
      "category": null,
      "price": 1179,
      "type": "one",
      "tax": "0",
      "period_type": "period",
      "dfrom": "0000-12-31",
      "dto": "0000-12-31",
      "id_restriction_plans": "0",
      "image": "",
      "use_on_booking_engine": "1",
      "date_created": "2021-05-28 14:24:43",
      "id_extras_category": "0"
    },
    {
      "id_properties": "93",
      "id_extras": "15",
      "name": "Extras 1",
      "description": "",
      "category": null,
      "price": 1179,
      "type": "one",
      "tax": "0",
      "period_type": "period",
      "dfrom": "0001-01-01",
      "dto": "0001-01-01",
      "id_restriction_plans": "0",
      "image": "",
      "use_on_booking_engine": "1",
      "date_created": "2021-05-31 18:09:50",
      "id_extras_category": "0"
    },
    {
      "id_properties": "93",
      "id_extras": "16",
      "name": "Extras 1",
      "description": "",
      "category": null,
      "price": 1179,
      "type": "one",
      "tax": "0",
      "period_type": "period",
      "dfrom": "0001-01-01",
      "dto": "0001-01-01",
      "id_restriction_plans": "0",
      "image": "",
      "use_on_booking_engine": "1",
      "date_created": "2021-05-31 18:10:06",
      "id_extras_category": "0"
    },
    {
      "id_properties": "93",
      "id_extras": "710",
      "name": "rtrtrt",
      "description": "",
      "category": null,
      "price": 120,
      "type": "one",
      "tax": "0",
      "period_type": "period",
      "dfrom": "0001-01-01",
      "dto": "0001-01-01",
      "id_restriction_plans": "0",
      "image": "",
      "use_on_booking_engine": "1",
      "date_created": "2021-06-19 17:37:00",
      "id_extras_category": "0"
    },
    {
      "id_properties": "93",
      "id_extras": "712",
      "name": "MNNM",
      "description": "",
      "category": null,
      "price": 14148,
      "type": "one",
      "tax": "0",
      "period_type": "period",
      "dfrom": "0001-01-01",
      "dto": "0001-01-01",
      "id_restriction_plans": "0",
      "image": "",
      "use_on_booking_engine": "1",
      "date_created": "2021-06-19 17:38:09",
      "id_extras_category": "0"
    },
    {
      "id_properties": "93",
      "id_extras": "1399",
      "name": "dsadas",
      "description": "",
      "category": null,
      "price": 27234.9,
      "type": "one",
      "tax": "0",
      "period_type": "period",
      "dfrom": "0001-01-01",
      "dto": "0001-01-01",
      "id_restriction_plans": "0",
      "image": "",
      "use_on_booking_engine": "1",
      "date_created": "2021-07-06 16:23:18",
      "id_extras_category": "0"
    },
    {
      "id_properties": "93",
      "id_extras": "1400",
      "name": "dsadas",
      "description": "",
      "category": "Kategorija Test",
      "price": 27234.9,
      "type": "one",
      "tax": "0",
      "period_type": "period",
      "dfrom": "0001-01-01",
      "dto": "0001-01-01",
      "id_restriction_plans": "0",
      "image": "",
      "use_on_booking_engine": "1",
      "date_created": "2021-07-06 16:24:54",
      "id_extras_category": "164"
    },
    {
      "id_properties": "93",
      "id_extras": "1401",
      "name": "dsadsa",
      "description": "",
      "category": null,
      "price": 181.86,
      "type": "one",
      "tax": "0",
      "period_type": "period",
      "dfrom": "0001-01-01",
      "dto": "0001-01-01",
      "id_restriction_plans": "0",
      "image": "",
      "use_on_booking_engine": "1",
      "date_created": "2021-07-06 17:04:37",
      "id_extras_category": "0"
    },
    {
      "id_properties": "93",
      "id_extras": "2392",
      "name": "Extras 2",
      "description": "ryrty rtyrty",
      "category": null,
      "price": 589.5,
      "type": "one",
      "tax": "0",
      "period_type": "period",
      "dfrom": "2019-01-17",
      "dto": "2020-01-24",
      "id_restriction_plans": "0",
      "image": "",
      "use_on_booking_engine": "1",
      "date_created": "2021-08-27 17:28:53",
      "id_extras_category": "0"
    },
    {
      "id_properties": "93",
      "id_extras": "2810",
      "name": "Test",
      "description": "sfsf",
      "category": null,
      "price": 10,
      "type": "one",
      "tax": "12",
      "period_type": "restriction",
      "dfrom": "0001-01-01",
      "dto": "0001-01-01",
      "id_restriction_plans": "193",
      "image": "",
      "use_on_booking_engine": "1",
      "date_created": "2021-10-14 13:42:09",
```

_(response truncated — original length 63.633 characters)_

---

### Get extra <a id="get-extra"></a>

`POST` `https://app.otasync.me/api/extras/data/extra`

**Add Extra Information**

This endpoint allows you to add extra information by sending an HTTP POST request to `https://app.otasync.me/api/extras/data/extra`.

**Request Body**

- token (text): The authentication token for the request.
- key (text): The key for the request.
- id_extras (text): The ID of the extra information to be added.
- id_properties (text): The ID of the properties.

**Response**

The response includes the added extra information along with the list of rooms that already have this extra included ("room_types_extras") and the list "extras_room_types". If "extras_room_types" is not empty, the extra will only be available for those rooms.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_extras": 16,
  "id_properties": 93
}
```

**Example response — Get extra** `200 OK`

```json
{
  "id_properties": 93,
  "id_extras": 16,
  "name": "Extras 1",
  "description": "",
  "price": 1179,
  "type": "one",
  "tax": "0",
  "id_extras_category": 0,
  "period_type": "period",
  "dfrom": "0001-01-01",
  "dto": "0001-01-01",
  "id_restriction_plans": 0,
  "image": "",
  "use_on_booking_engine": 1,
  "date_created": "2021-05-31 18:10:06",
  "mandatory": 0,
  "category_name": null,
  "category_image": null,
  "use_on_home_guest_app": null,
  "owner_fee": 0,
  "agent_fee": 0,
  "extras_room_types": [],
  "room_types_extras": [],
  "restrictionExtras": null,
  "mandatory_room_types": []
}
```

---

### Delete extra <a id="delete-extra"></a>

`POST` `https://app.otasync.me/api/extras/delete/extra`

**Request**

This POST request is used to delete an extra by providing the necessary parameters in the request body.

**Request Body**

- token (string): The authentication token for the request.
- key (string): The key for the request.
- id_extras (number): The ID of the extra to be deleted.
- id_properties (number): The ID of the property associated with the extra.

**Response**

The response of this request is a JSON schema representing the structure of the response data.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_extras": 17,
  "id_properties": 93
}
```

**Example response — Delete extra** `200 OK`

```json
{
  "id_extras": 17,
  "id_changelog": 12197816
}
```

---

### Update extra <a id="update-extra"></a>

`POST` `https://app.otasync.me/api/extras/edit/extra`

**Update Extra**

This endpoint allows you to update an existing extra by providing the necessary details in the request body.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_extras` (integer): The ID of the extra to be updated.
- `name` (string): The name of the extra.
- `price` (number): The price of the extra.
- `tax` (number): The tax amount for the extra.
- `type` (string): The type of the extra.
- `description` (string): The description of the extra.
- `dfrom` (string): The start date for the extra.
- `dto` (string): The end date for the extra.
- `period_type` (string): The period type for the extra.
- `id_properties` (integer): The ID of the property associated with the extra.
- `id_restriction_plans` (integer): The ID of the restriction plan for the extra.
- `use_on_booking_engine` (integer): Indicator for using the extra on the booking engine.
- `rooms` (array of integers): The IDs of the rooms where the extra is applicable.
- `specific_rooms` (array of integers): The specific room IDs for the extra.
- `image` (string): The image of the extra.

**Response Body**

The response to the request will contain the updated details of the extra.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_extras": 2392,
  "name": "Extras 2",
  "price": 589.5,
  "tax": 0,
  "type": "one",
  "description": "ryrty rtyrty",
  "dfrom": "2019-01-17",
  "dto": "2020-01-24",
  "period_type": "period",
  "id_properties": 93,
  "id_restriction_plans": 0,
  "use_on_booking_engine": 1,
  "rooms": [
    173,
    174
  ],
  "specific_rooms": [
    170,
    171
  ],
  "image": ""
}
```

---

### Insert extra <a id="insert-extra"></a>

`POST` `https://app.otasync.me/api/extras/insert/extra`

**Create a New Extra**

This endpoint allows you to insert a new extra into the system.

**Request Body**

- `token` (string): The authentication token.
- `key` (string): The key for authentication.
- `name` (string): The name of the extra.
- `price` (number): The price of the extra.
- `tax` (number): The tax amount for the extra.
- `type` (string): The type of the extra, which can be one of the following:
  - "room" - Per room
  - "person" - Per person
  - "one" - One time
  - "room_daily" - Per room (daily)
  - "person_daily" - Per person (daily)
- `description` (string): The description of the extra.
- `dfrom` (string): The start date for the extra's validity period.
- `dto` (string): The end date for the extra's validity period.
- `period_type` (string): The type of period for the extra, which can be one of the following:
  - "period" - The fields "dfrom" and "dto" are required, and the extra will only be valid for that period.
  - "restriction" - The field "id_restriction_plans" is required, and the extra will only be valid for dates when the restriction plan is not closed.
- `id_properties` (number): The ID of the property to which the extra belongs.
- `id_restriction_plans` (number): The ID of the restriction plan for the extra.
- `use_on_booking_engine` (number): Indicates whether the extra can be used on the booking engine.
- `rooms` (array): An array of room IDs to which the extra applies.
- `specific_rooms` (array): An array of specific room IDs to which the extra applies.
- `image` (string): The image of the extra.

**Response Body**

The response body contains the result of the insertion operation.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "name": "Test",
  "price": 10,
  "tax": 12,
  "category": 0,
  "mandatory": 0,
  "type": "one",
  "id_extras_category": 1,
  "description": "sfsf",
  "dfrom": "0001-01-01",
  "dto": "0001-01-01",
  "period_type": "restriction",
  "id_properties": 93,
  "id_restriction_plans": 193,
  "use_on_booking_engine": 1,
  "mandatory_in_rooms": [
    172,
    174
  ],
  "rooms": [
    170,
    171
  ],
  "specific_rooms": [],
  "image": ""
}
```

---

## Guests <a id="guests"></a>

### Get guests <a id="get-guests"></a>

`POST` `https://app.otasync.me/api/guests/data/guests`

**POST /api/guests/data/guests**

Returns a list of guests with pagination. Filter parameters are optional and can include:

- "filter_by" - "date_received" or "date_arrival"
- "arrivals" - Only show arrivals for today
- "departures" - Only show departures for today
- "dfrom" - Date of the guest's reservation (depending on "filter_by")
- "dto" - Date of the guest's reservation (depending on "filter_by")
- "rooms" - (array) room type IDs of the reservations of the guest.
- "min_price" - Total paid amount by the guest
- "max_price" - Total paid amount by the guest
- "min_nights" - Total nights of the guest
- "max_nights" - Total nights of the guest
- "channels" - (array) channel IDs of the reservations of the guest.
- "countries" - (array) ISO-2 country codes.
- "order_type" - (ASC/DESC)
- "order_by" - "first_name", "last_name", "email", etc.

**Request Body**

- token (string): The authentication token
- key (string): The key for authentication
- id_properties (number): The ID of the properties
- page (number): The page number

**Response (JSON Schema)**

```json
{
  "type": "object",
  "properties": {
    "guests": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          // Properties of the guest object
        }
      }
    },
    "pagination": {
      "type": "object",
      "properties": {
        // Properties of the pagination object
      }
    }
  }
}
```

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "551632b4b442e3af67b89514c33f7b90351c2e09",
  "id_properties": 93,
  "page": 1,
  "dfrom": "2024-11-26",
  "dto": "2024-11-27"
}
```

**Example response — Get guests** `200 OK`

```json
{
  "total_pages_number": 20,
  "page": "1",
  "guests": [
    {
      "id_channels": null,
      "country": "",
      "date_arrival": null,
      "date_departure": null,
      "id_room_types": null,
      "is_checkin": null,
      "is_checkout": null,
      "date_checkin": null,
      "date_checkout": null,
      "travel_document_number_co": null,
      "id_guests": "41212",
      "id_properties": "93",
      "first_name": "yyy",
      "last_name": "yyy",
      "email": "",
      "phone": "",
      "address": "",
      "city": "",
      "zip": "",
      "travel_document_number": "",
      "travel_document_type": "--",
      "date_of_birth": "0001-01-01",
      "gender": "M",
      "host_again": null,
      "note": "",
      "total_nights": "0",
      "total_arrivals": "0",
      "total_paid": "0",
      "id_companies": "",
      "exclude_city_tax": "0",
      "merged_to_guest": null,
      "date_merged": null,
      "is_deleted": "0",
      "date_deleted": null,
      "is_modified": "1",
      "date_modified": "2021-07-09 10:56:19",
      "date_created": "2021-07-09 10:56:02"
    },
    {
      "id_channels": null,
      "country": "AF",
      "date_arrival": null,
      "date_departure": null,
      "id_room_types": null,
      "is_checkin": null,
      "is_checkout": null,
      "date_checkin": null,
      "date_checkout": null,
      "travel_document_number_co": null,
      "id_guests": "2328368",
      "id_properties": "93",
      "first_name": "xdfdx",
      "last_name": "fsdf",
      "email": "email@email.com",
      "phone": "123321123",
      "address": "Address",
      "city": "City",
      "zip": "12311",
      "travel_document_number": "",
      "travel_document_type": "--",
      "date_of_birth": "0001-01-01",
      "gender": "M",
      "host_again": null,
      "note": "Note",
      "total_nights": "0",
      "total_arrivals": "0",
      "total_paid": "0",
      "id_companies": "0",
      "exclude_city_tax": "0",
      "merged_to_guest": null,
      "date_merged": null,
      "is_deleted": "0",
      "date_deleted": null,
      "is_modified": "1",
      "date_modified": "2023-07-11 15:58:42",
      "date_created": "2023-07-11 15:55:13"
    },
    {
      "id_channels": null,
      "country": "AF",
      "date_arrival": null,
      "date_departure": null,
      "id_room_types": null,
      "is_checkin": "0",
      "is_checkout": "0",
      "date_checkin": null,
      "date_checkout": null,
      "travel_document_number_co": "",
      "id_guests": "2694953",
      "id_properties": "93",
      "first_name": "xdfdx",
      "last_name": "fsdf",
      "email": "email@email.com",
      "phone": "123321123",
      "address": "Address",
      "city": "City",
      "zip": "12311",
      "travel_document_number": "",
      "travel_document_type": "--",
      "date_of_birth": "1970-01-01",
      "gender": "M",
      "host_again": null,
      "note": "Note",
      "total_nights": "0",
      "total_arrivals": "0",
      "total_paid": "0",
      "id_companies": "0",
      "exclude_city_tax": "0",
      "merged_to_guest": null,
      "date_merged": null,
      "is_deleted": "0",
      "date_deleted": null,
      "is_modified": "1",
      "date_modified": "2024-04-26 13:17:23",
      "date_created": "2024-04-24 10:05:50"
    },
    {
      "id_channels": null,
      "country": "",
      "date_arrival": null,
      "date_departure": null,
      "id_room_types": null,
      "is_checkin": null,
      "is_checkout": null,
      "date_checkin": null,
      "date_checkout": null,
      "travel_document_number_co": null,
      "id_guests": "2288237",
      "id_properties": "93",
      "first_name": "vikd",
      "last_name": "dd",
      "email": "",
      "phone": "",
      "address": "",
      "city": "",
      "zip": "",
      "travel_document_number": "",
      "travel_document_type": "--",
      "date_of_birth": "0001-01-01",
      "gender": "M",
      "host_again": null,
      "note": "",
      "total_nights": "0",
      "total_arrivals": "0",
      "total_paid": "0",
      "id_companies": "",
      "exclude_city_tax": "0",
      "merged_to_guest": null,
      "date_merged": null,
      "is_deleted": "0",
      "date_deleted": null,
      "is_modified": "0",
      "date_modified": null,
      "date_created": "2023-06-22 15:13:48"
    },
    {
      "id_channels": null,
      "country": "",
      "date_arrival": null,
      "date_departure": null,
      "id_room_types": null,
      "is_checkin": null,
      "is_checkout": null,
      "date_checkin": null,
      "date_checkout": null,
      "travel_document_number_co": null,
      "id_guests": "2264017",
      "id_properties": "93",
      "first_name": "tt",
      "last_name": "tt",
      "email": "",
      "phone": "",
      "address": "",
      "city": "1",
      "zip": "1",
      "travel_document_number": "1",
      "travel_document_type": "83",
      "date_of_birth": "2021-05-20",
      "gender": "F",
      "host_again": null,
      "note": "sdfsdf",
      "total_nights": "0",
      "total_arrivals": "0",
      "total_paid": "-1000",
      "id_companies": "0",
      "exclude_city_tax": "0",
      "merged_to_guest": null,
      "date_merged": null,
      "is_deleted": "0",
      "date_deleted": null,
      "is_modified": "1",
      "date_modified": "2023-06-07 11:07:46",
      "date_created": "2023-06-07 11:06:01"
    },
    {
      "id_channels": null,
      "country": "",
      "date_arrival": null,
      "date_departure": null,
      "id_room_types": null,
      "is_checkin": null,
      "is_checkout": null,
      "date_checkin": null,
      "date_checkout": null,
      "travel_document_number_co": null,
      "id_guests": "2264398",
      "id_properties": "93",
      "first_name": "tt",
      "last_name": "tt",
      "email": "",
      "phone": "",
      "address": "",
      "city": "1",
      "zip": null,
      "travel_document_number": null,
      "travel_document_type": null,
      "date_of_birth": null,
      "gender": null,
      "h
```

_(response truncated — original length 20.869 characters)_

---

### Search guests <a id="search-guests"></a>

`POST` `https://app.otasync.me/api/search/data/guest`

**Retrieve Guest Data**

This API endpoint allows you to retrieve a list of guests with pagination. You can use filter parameters to narrow down the search results based on various criteria.

**Request Body**

- token (string): The authentication token for the request.
- key (string): The key for the request.
- id_properties (number): The ID of the property.
- page (number): The page number for pagination.
- travel_document_number (string): The travel document number of the guest.
- first_name (string): The first name of the guest.
- last_name (string): The last name of the guest.

**Response Body (JSON Schema)**

```json
{
  "type": "object",
  "properties": {
    "guests": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "guest_id": { "type": "string" },
          "first_name": { "type": "string" },
          "last_name": { "type": "string" },
          "email": { "type": "string" },
          "phone": { "type": "string" },
          "reservation_id": { "type": "string" },
          "check_in_date": { "type": "string", "format": "date" },
          "check_out_date": { "type": "string", "format": "date" }
          // Add more properties as per the actual response
        }
      }
    },
    "total_guests": { "type": "number" },
    "page": { "type": "number" },
    "total_pages": { "type": "number" }
  }
}
```

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "551632b4b442e3af67b89514c33f7b90351c2e09",
  "id_properties": 93,
  "page": 1,
  "travel_document_number": "1103998230028",
  "first_name": "viktor",
  "last_name": "ciric"
}
```

**Example response — Search guests** `200 OK`

```json
{
  "id_reservations": 0,
  "id_guests": 0
}
```

---

### Get guest <a id="get-guest"></a>

`POST` `https://app.otasync.me/api/guests/data/guest`

**Create Guest Information**

This endpoint allows you to create guest information.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_properties` (number): The ID of the properties associated with the guest.
- `id_guests` (number): The ID of the guest.

**Response Body**

The response will contain the created guest information.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "551632b4b442e3af67b89514c33f7b90351c2e09",
  "id_properties": 93,
  "id_guests": 29702
}
```

**Example response — Get guest** `200 OK`

```json
{
  "id_eturist_serbia": null,
  "id_guests": 29702,
  "DaLiJeLiceDomace": null,
  "DaLiJeLiceRodjenoUInostranstvu": null,
  "jmbg": null,
  "birth_guest": null,
  "MestoRodjenjaNaziv": null,
  "DrzavaRodjenjaAlfa2": null,
  "DrzavaRodjenjaAlfa3": null,
  "DrzavljanstvoAlfa2": null,
  "DrzavljanstvoAlfa3": null,
  "OpstinaPrebivalistaMaticniBroj": null,
  "OpstinaPrebivalistaNaziv": null,
  "MestoPrebivalistaMaticniBroj": null,
  "MestoPrebivalistaNaziv": null,
  "DrzavaPrebivalistaAlfa2": null,
  "DrzavaPrebivalistaAlfa3": null,
  "VrstaPutneIspraveSifra": null,
  "BrojPutneIsprave": null,
  "DatumIzdavanjaPutneIsprave": null,
  "VrstaVizeSifra": null,
  "BrojVize": null,
  "MestoIzdavanjaVize": null,
  "DatumUlaskaURepublikuSrbiju": null,
  "MestoUlaskaURepublikuSrbijuSifra": null,
  "MestoUlaskaURepublikuSrbiju": null,
  "DatumDoKadaJeOdobrenBoravakURepubliciSrbiji": null,
  "UgostiteljskiObjekatJedinstveniIdentifikator": null,
  "VrstaPruzenihUslugaSifra": null,
  "NacinDolaskaSifra": null,
  "NazivAgencije": null,
  "BrojSmestajneJedinice": null,
  "SpratSmestajneJedinice": null,
  "DatumICasDolaska": null,
  "PlaniraniDatumOdlaska": null,
  "UslovZaUmanjenjeBoravisneTakseSifra": null,
  "RazlogBoravkaSifra": null,
  "BarkodVaucera": null,
  "dodatNaETurist": null,
  "ObrisanNaEturist": null,
  "putnaIspravaVaziDo": null,
  "BrojPruzenihUslugaSmestaja": null,
  "jedinstveniIdentifikator": null,
  "id_eturist": null,
  "datum_prijave": null,
  "datum_odjave": null,
  "id_properties": 93,
  "first_name": "yy",
  "last_name": "yy",
  "email": "",
  "phone": "",
  "address": "",
  "city": "",
  "zip": "",
  "country": "",
  "travel_document_number": "",
  "travel_document_type": "--",
  "date_of_birth": "0001-01-01",
  "gender": "Z",
  "host_again": null,
  "note": "",
  "total_nights": 3,
  "total_arrivals": 1,
  "total_paid": 315,
  "id_companies": "64",
  "exclude_city_tax": 0,
  "merged_to_guest": null,
  "date_merged": null,
  "is_deleted": 0,
  "date_deleted": null,
  "is_modified": 1,
  "date_modified": "2021-11-16 12:06:53",
  "date_created": "2021-06-23 10:59:22",
  "guestapp_images": []
}
```

---

### Edit guest <a id="edit-guest"></a>

`POST` `https://app.otasync.me/api/guests/edit/guest`

**Edit Guest Data**

This endpoint allows you to edit guest data by sending an HTTP POST request to the specified URL.

**Request Body**

The request should include the following parameters in the raw request body:

- `token`: (string) The authentication token for authorization.
- `key`: (string) The key for accessing the guest data.
- `id_properties`: (number) The ID of the properties associated with the guest.
- `id_guests`: (number) The ID of the guest to be edited.
- `first_name`: (string) The first name of the guest.
- `last_name`: (string) The last name of the guest.
- `email`: (string) The email address of the guest.
- `company`: (string) The company associated with the guest.
- `phone`: (string) The phone number of the guest.
- `address`: (string) The address of the guest.
- `city`: (string) The city of the guest.
- `zip`: (string) The zip code of the guest's location.
- `country`: (string) The country of the guest.
- `date_of_birth`: (string) The date of birth of the guest.
- `gender`: (string) The gender of the guest.
- `guestapp_images`: (array) An array of guest images.
- `note`: (string) Any additional notes related to the guest.

**Response**

The response to this request will contain the updated guest data or an error message if the request was unsuccessful.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "551632b4b442e3af67b89514c33f7b90351c2e09",
  "id_properties": 93,
  "id_guests": 47965,
  "first_name": "xdfdx",
  "last_name": "fsdf",
  "email": "email@email.com",
  "company": "0",
  "phone": "123321123",
  "address": "Address",
  "city": "City",
  "zip": "12311",
  "country": "AF",
  "date_of_birth": "1970-01-01",
  "gender": "M",
  "guestapp_images": [],
  "note": "Note"
}
```

**Example response — Edit guest** `200 OK`

```json
{
  "id_guests": "47965",
  "id_changelog": 12197872,
  "guest": {
    "id_guests": 47965,
    "id_properties": 93,
    "first_name": "xdfdx",
    "last_name": "fsdf",
    "email": "email@email.com",
    "phone": "123321123",
    "address": "Address",
    "city": "City",
    "zip": "12311",
    "country": "AF",
    "travel_document_number": "",
    "travel_document_type": "--",
    "date_of_birth": "1970-01-01",
    "gender": "M",
    "host_again": null,
    "note": "Note",
    "total_nights": 1,
    "total_arrivals": 1,
    "total_paid": 1.25445,
    "id_companies": "0",
    "exclude_city_tax": 0,
    "merged_to_guest": null,
    "date_merged": null,
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 1,
    "date_modified": "2025-02-05 17:20:14",
    "date_created": "2021-07-15 17:17:25"
  },
  "old_guest": {
    "id_guests": 47965,
    "id_properties": 93,
    "first_name": "xdfdx",
    "last_name": "fsdf",
    "email": "email@email.com",
    "phone": "123321123",
    "address": "Address",
    "city": "City",
    "zip": "12311",
    "country": "AF",
    "travel_document_number": "",
    "travel_document_type": "--",
    "date_of_birth": "1982-03-24",
    "gender": "M",
    "host_again": null,
    "note": "Note",
    "total_nights": 1,
    "total_arrivals": 1,
    "total_paid": 1.25445,
    "id_companies": "0",
    "exclude_city_tax": 0,
    "merged_to_guest": null,
    "date_merged": null,
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 1,
    "date_modified": "2024-08-16 17:19:30",
    "date_created": "2021-07-15 17:17:25"
  }
}
```

---

### Insert guest <a id="insert-guest"></a>

`POST` `https://app.otasync.me/api/guests/insert/guest`

**Insert Guest Data**

This endpoint is used to insert guest data into the system.

**Request Body**

- token (string): The authentication token for the request.
- key (string): The key for the request.
- id_properties (string): The ID of the properties.
- id_guests (string): The ID of the guest.
- first_name (string): The first name of the guest.
- last_name (string): The last name of the guest.
- email (string): The email address of the guest.
- company (string): The ID of the company.
- phone (string): The phone number of the guest.
- address (string): The address of the guest.
- city (string): The city of the guest.
- zip (string): The zip code of the guest.
- country (string): The country of the guest.
- date_of_birth (string): The date of birth of the guest.
- gender (string): The gender of the guest.
- guestapp_images (array): An array of guest images.
- note (string): A note about the guest.

**Response**

The response of this request is a JSON schema.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "551632b4b442e3af67b89514c33f7b90351c2e09",
  "id_properties": "93",
  "id_guests": "",
  "first_name": "Viktor",
  "last_name": "Test",
  "email": "viktor@gmail.com",
  "company": "64",
  "phone": "2034982304",
  "address": "Adresa",
  "city": "Grad",
  "zip": "11000",
  "country": "RS",
  "date_of_birth": "1982-02-02",
  "gender": "M",
  "guestapp_images": [],
  "note": "sfsdfsdf"
}
```

**Example response — Insert guest** `201 Created`

```json
{
  "id_guests": 3296676,
  "id_changelog": 12197880,
  "guest": {
    "id_eturist_serbia": 221755701,
    "id_guests": 3296676,
    "DaLiJeLiceDomace": "true",
    "DaLiJeLiceRodjenoUInostranstvu": "false",
    "jmbg": "",
    "birth_guest": "1970-01-01",
    "MestoRodjenjaNaziv": "",
    "DrzavaRodjenjaAlfa2": "",
    "DrzavaRodjenjaAlfa3": null,
    "DrzavljanstvoAlfa2": "",
    "DrzavljanstvoAlfa3": null,
    "OpstinaPrebivalistaMaticniBroj": "0",
    "OpstinaPrebivalistaNaziv": "",
    "MestoPrebivalistaMaticniBroj": "0",
    "MestoPrebivalistaNaziv": "",
    "DrzavaPrebivalistaAlfa2": "RS",
    "DrzavaPrebivalistaAlfa3": null,
    "VrstaPutneIspraveSifra": "",
    "BrojPutneIsprave": "",
    "DatumIzdavanjaPutneIsprave": "2025-02-05",
    "VrstaVizeSifra": "",
    "BrojVize": "",
    "MestoIzdavanjaVize": "",
    "DatumUlaskaURepublikuSrbiju": "2025-02-05",
    "MestoUlaskaURepublikuSrbijuSifra": "",
    "MestoUlaskaURepublikuSrbiju": "",
    "DatumDoKadaJeOdobrenBoravakURepubliciSrbiji": "2025-02-05",
    "UgostiteljskiObjekatJedinstveniIdentifikator": "0",
    "VrstaPruzenihUslugaSifra": "",
    "NacinDolaskaSifra": "0",
    "NazivAgencije": "",
    "BrojSmestajneJedinice": "",
    "SpratSmestajneJedinice": "",
    "DatumICasDolaska": "0001-01-01 00:00:00",
    "PlaniraniDatumOdlaska": "0001-01-01 00:00:00",
    "UslovZaUmanjenjeBoravisneTakseSifra": "",
    "RazlogBoravkaSifra": "",
    "BarkodVaucera": "",
    "dodatNaETurist": 0,
    "ObrisanNaEturist": 0,
    "putnaIspravaVaziDo": "1970-01-01",
    "BrojPruzenihUslugaSmestaja": "1",
    "jedinstveniIdentifikator": null,
    "id_eturist": "3296676",
    "datum_prijave": null,
    "datum_odjave": null,
    "id_properties": 93,
    "first_name": "Viktor",
    "last_name": "Test",
    "email": "viktor@gmail.com",
    "phone": "2034982304",
    "address": "Adresa",
    "city": "Grad",
    "zip": "11000",
    "country": "RS",
    "travel_document_number": "",
    "travel_document_type": "--",
    "date_of_birth": "1982-02-02",
    "gender": "M",
    "host_again": null,
    "note": "sfsdfsdf",
    "total_nights": 0,
    "total_arrivals": 0,
    "total_paid": 0,
    "id_companies": "64",
    "exclude_city_tax": 0,
    "merged_to_guest": null,
    "date_merged": null,
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 0,
    "date_modified": null,
    "date_created": "2025-02-05 17:20:28",
    "guestapp_images": []
  }
}
```

---

### Delete guest <a id="delete-guest"></a>

`POST` `https://app.otasync.me/api/guests/delete/guest`

**Request**

- Method: POST
- Endpoint: `https://app.otasync.me/api/guests/delete/guest`
- Description: Delete a guest
- Body:
  - token (text, required): The authentication token
  - key (text, required): The key for authorization
  - id_properties (text, required): The ID of the properties
  - id_guests (text, required): The ID of the guest to be deleted

**Response**

- Content Type: application/json
- { "type": "object", "properties": { "status": { "type": "string" }, "message": { "type": "string" } } }

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "551632b4b442e3af67b89514c33f7b90351c2e09",
  "id_properties": 93,
  "id_guests": 1372
}
```

**Example response — Delete guest** `200 OK`

```json
{
  "id_guests": 1372,
  "id_changelog": 12197882
}
```

---

## Prices <a id="prices"></a>

### Get prices <a id="get-prices"></a>

`POST` `https://app.otasync.me/api/prices/data/prices`

**POST /api/prices/data/prices**

Returns availability of each room type for the specified date range, in the format 'id_room_types' => 'date' => 'value'.

**Request Body**

- token (text): The authentication token.
- key (text): The authentication key.
- id_properties (text): The ID of the properties.
- id_pricing_plans (text): The ID of the pricing plans.
- dfrom (text): Start date of the range.
- dto (text): End date of the range.

**Response**

The response will contain the availability of each room type for the specified date range in the format 'id_room_types' => 'date' => 'value'.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_pricing_plans": 370,
  "dfrom": "2022-01-01",
  "dto": "2022-01-10"
}
```

**Example response — Get prices** `200 OK`

```json
{
  "status": "ok",
  "data": {
    "172": {
      "2022-01-01": 60,
      "2022-01-02": 60,
      "2022-01-03": 60,
      "2022-01-04": 60,
      "2022-01-05": 60,
      "2022-01-06": 60,
      "2022-01-07": 60,
      "2022-01-08": 60,
      "2022-01-09": 60,
      "2022-01-10": 60
    },
    "174": {
      "2022-01-01": 57,
      "2022-01-02": 57,
      "2022-01-03": 57,
      "2022-01-04": 57,
      "2022-01-05": 57,
      "2022-01-06": 57,
      "2022-01-07": 57,
      "2022-01-08": 57,
      "2022-01-09": 57,
      "2022-01-10": 57
    },
    "175": {
      "2022-01-01": 70,
      "2022-01-02": 70,
      "2022-01-03": 70,
      "2022-01-04": 70,
      "2022-01-05": 70,
      "2022-01-06": 70,
      "2022-01-07": 70,
      "2022-01-08": 70,
      "2022-01-09": 70,
      "2022-01-10": 70
    },
    "4351": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "4352": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "4429": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "4974": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6396": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6397": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6400": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6405": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6413": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6415": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6416": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6418": {
      "2022-01-01": 100.789,
      "2022-01-02": 100.789,
      "2022-01-03": 100.789,
      "2022-01-04": 100.789,
      "2022-01-05": 100.789,
      "2022-01-06": 100.789,
      "2022-01-07": 100.789,
      "2022-01-08": 100.789,
      "2022-01-09": 100.789,
      "2022-01-10": 100.789
    },
    "6419": {
      "2022-01-01": 1,
      "2022-01-02": 1,
      "2022-01-03": 1,
      "2022-01-04": 1,
      "2022-01-05": 1,
      "2022-01-06": 1,
      "2022-01-07": 1,
      "2022-01-08": 1,
      "2022-01-09": 1,
      "2022-01-10": 1
    },
    "6420": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6421": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6422": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6423": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6424": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6432": {
      "2022-01-01": 100,
      "2022-01-02": 100,
      "2022-01-03": 100,
      "2022-01-04": 100,
      "2022-01-05": 100,
      "2022-01-06": 100,
      "2022-01-07": 100,
      "2022-01-08": 100,
      "2022-01-09": 100,
      "2022-01-10": 100
    },
    "6433": {
      "2022-01-01": 100,
```

_(response truncated — original length 11.028 characters)_

---

### Edit prices <a id="edit-prices"></a>

`POST` `https://app.otasync.me/api/prices/edit/prices`

**Update Room Prices**

This endpoint allows you to update the prices of room types within a specified period.

**Request Body**

- `token` (string): The authentication token.
- `key` (string): The key for authorization.
- `id_properties` (number): The ID of the property.
- `id_pricing_plans` (number): The ID of the pricing plan.
- `dfrom` (string): The start date for the price update (e.g., "2022-01-01").
- `dto` (string): The end date for the price update (e.g., "2022-01-10").
- `rooms` (array): An array of objects containing the following:
  - `id_room_types` (number): The ID of the room type.
  - `value` (number): The new price value.
- `variation_type` (number): The type of price variation:
  - -2: Decreases price by the sent value.
  - -1: Decreases price by percentage.
  - 0: Sets the price to the sent value.
  - 1: Increases price by percentage.
  - 2: Increases price by the sent value.
- `weekdays` (array, optional): An array of 7 values (1 or 0) indicating which days of the week will be updated (Starting from Sunday).

**Response Body (JSON Schema)**

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  }
}
```

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "d63f67009cca8821d75c385c48564f493002bc0e",
  "id_properties": 93,
  "id_pricing_plans": 370,
  "dfrom": "2022-01-01",
  "dto": "2022-01-10",
  "rooms": [
    {
      "id_room_types": 170,
      "value": 20
    }
  ],
  "variation_type": 0,
  "weekdays": [
    1,
    1,
    1,
    1,
    1,
    1,
    1
  ]
}
```

---

### Reservation room type prices <a id="reservation-room-type-prices"></a>

`POST` `https://app.otasync.me/api/prices/data/reservation_room_type_prices`

The HTTP POST request to the `https://app.otasync.me/api/prices/data/reservation_room_type_prices` endpoint is used to retrieve reservation room type prices. The request requires a payload with the following parameters:

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_properties` (integer): The ID of the properties.
- `dfrom` (string): The start date for the reservation in the format 'YYYY-MM-DD'.
- `dto` (string): The end date for the reservation in the format 'YYYY-MM-DD'.
- `id_pricing_plans` (integer): The ID of the pricing plans.
- `id_room_types` (integer): The ID of the room types.
- `children_1` (integer): The number of children in age group 1.
- `children_2` (integer): The number of children in age group 2.
- `children_3` (integer): The number of children in age group 3.
- `adults` (integer): The number of adults.
- `seniors` (integer): The number of seniors.

The response to this request will be documented as a JSON schema.

**Request body** (`raw`)

```json
{
  "token": "33f7c1bfbdb6c5bb4bbe022e1307b7662a6ddd74",
  "key": "6a8ee6cb205e35574cd870c129a543e440128911",
  "id_properties": 28,
  "dfrom": "2022-07-26",
  "dto": "2022-07-28",
  "id_pricing_plans": 32,
  "id_room_types": 40,
  "children_1": 1,
  "children_2": 0,
  "children_3": 0,
  "adults": 1,
  "seniors": 0
}
```

---

## Pricing plans <a id="pricing-plans"></a>

### Get pricing plans <a id="get-pricing-plans"></a>

`POST` `https://app.otasync.me/api/pricingPlan/data/pricing_plans`

**Create Pricing Plan Data**

This endpoint allows you to retrieve a list of all Pricing Plans for the property. Each pricing plan is associated with a linked restriction plan, a default board, and a cancellation policy.

The type of the pricing plan can be either "daily" or "virtual". Daily pricing plans have individual prices for each room type and date. In addition, you can define prices by periods for the current year or copy them for all years using the "copy_periods" field. Virtual pricing plans inherit prices from their parent plan with a variation.

The variation type can be:

- -2: Decreases price by the specified amount.
- -1: Decreases price by the specified percentage.
- 1: Increases price by the specified percentage.
- 2: Increases price by the specified amount.

**Request Body**

- token (string): The token for authentication.
- key (string): The key for authorization.
- id_properties (number): The ID of the property for which pricing plans are being fetched.

**Response (JSON Schema)**

```json
{
  "type": "object",
  "properties": {
    "pricingPlans": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "planId": {
            "type": "number"
          },
          "type": {
            "type": "string"
          },
          "restrictionPlan": {
            "type": "object",
            "properties": {
              // Restriction plan properties
            }
          },
          "defaultBoard": {
            "type": "object",
            "properties": {
              // Default board properties
            }
          },
          "cancellationPolicy": {
            "type": "object",
            "properties": {
              // Cancellation policy properties
            }
          }
        }
      }
    }
  }
}
```

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93
}
```

**Example response — Get pricing plans** `200 OK`

```json
[
  {
    "id_pricing_plans": 11029,
    "id_properties": 93,
    "name": "Test fixed",
    "id_board_names": 9,
    "id_policies": 93,
    "id_restriction_plans": 193,
    "id_boards": 837,
    "booking_engine": 1,
    "description": "",
    "type": "daily",
    "copy_periods": 0,
    "variation_type": "-2",
    "variation_amount": 0,
    "parent_id": "0",
    "first_meal": "",
    "date_created": "2024-03-08 14:31:29",
    "prices_per_person_active": 0,
    "locked_price": 0
  },
  {
    "id_pricing_plans": 14379,
    "id_properties": 93,
    "name": "Neolab test",
    "id_board_names": 8,
    "id_policies": 93,
    "id_restriction_plans": 193,
    "id_boards": 836,
    "booking_engine": 1,
    "description": "",
    "type": "daily",
    "copy_periods": 0,
    "variation_type": "-2",
    "variation_amount": 0,
    "parent_id": "0",
    "first_meal": "",
    "date_created": "2024-07-03 13:18:49",
    "prices_per_person_active": 0,
    "locked_price": 0
  },
  {
    "id_pricing_plans": 15774,
    "id_properties": 93,
    "name": "NOCENJE SA DORUCKOM RACK",
    "id_board_names": 1,
    "id_policies": 6638,
    "id_restriction_plans": 9467,
    "id_boards": 829,
    "booking_engine": 1,
    "description": "NOCENJE SA DORUCKOM RACK",
    "type": "daily",
    "copy_periods": 0,
    "variation_type": "-2",
    "variation_amount": 0,
    "parent_id": "0",
    "first_meal": "none",
    "date_created": "2024-09-13 16:21:38",
    "prices_per_person_active": 0,
    "locked_price": 0
  }
]
```

---

### Get pricing plan <a id="get-pricing-plan"></a>

`POST` `https://app.otasync.me/api/pricingPlan/data/pricing_plan`

**Request Body**

- token (string): The authentication token for the request.
- key (string): The key for the request.
- id_properties (integer): The ID of the properties.
- id_pricing_plans (integer): The ID of the pricing plan.

**Response Body**

The response body is a JSON schema containing information about the pricing plan.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_pricing_plans": 373
}
```

**Example response — Get pricing plan** `200 OK`

```json
{
  "extras": [],
  "periods": [],
  "price_per_persons": []
}
```

---

### Delete pricing plan <a id="delete-pricing-plan"></a>

`POST` `https://app.otasync.me/api/pricingPlan/delete/pricing_plan`

**Delete Pricing Plan**

Deletes a pricing plan.

- Method: POST
- URL: `https://app.otasync.me/api/pricingPlan/delete/pricing_plan`

**Request Body**

- Type: Raw
- The request body should include the following parameters:
  - `token` (string) - The authentication token for the request.
  - `key` (string) - The key for the request.
  - `id_pricing_plans` (number) - The ID of the pricing plan to be deleted.
  - `id_properties` (number) - The ID of the properties associated with the pricing plan.

**Response (JSON Schema)**

- The response will be a JSON object with the following properties:
  - `status` (string) - Indicates the status of the request.
  - `message` (string) - Provides a message regarding the outcome of the request.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_pricing_plans": 1560,
  "id_properties": 93
}
```

**Example response — Delete pricing plan** `200 OK`

```json
{
  "id_pricing_plans": "1560"
}
```

---

### Insert pricing plan <a id="insert-pricing-plan"></a>

`POST` `https://app.otasync.me/api/pricingPlan/insert/pricing_plan`

**Create New Pricing Plan**

This API endpoint is used to insert a new pricing plan into the system.

**Request Body**

- key (text): The unique key for authentication.
- token (text): The authentication token.
- name (text): The name of the pricing plan, e.g., "Test fixed".
- type (text): The type of pricing plan, e.g., "daily".
- vpid (text): The unique identifier for the pricing plan.
- variation_amount (text): The variation amount for the pricing plan.
- variation_type (text): The type of variation for the pricing plan.
- id_policies (text): The identifier for the policies associated with the pricing plan.
- booking_engine (text): The booking engine for the pricing plan.
- board (text): The board identifier for the pricing plan.
- restriction_plan (text): The restriction plan identifier for the pricing plan.
- description (text): The description of the pricing plan.
- copy (text): The copy identifier for the pricing plan.
- parent_id (text): The parent identifier for the pricing plan.
- id_properties (text): The identifier for the properties associated with the pricing plan.
- periods (text): The periods for the pricing plan, including room_id, room_price, etc.
- release_period (text): The release period for the pricing plan.
- release_period_active (text): The active status for the release period.
- prices_per_person_active (text): The active status for prices per person.
- prices_per_person (text): The prices per person for the pricing plan.
- inherit_price_id_pricing_plans (text): The identifier for inheriting price from other pricing plans.
- locked_price (text): The locked price status for the pricing plan.
- copy_pricing_plans_items (text): The items to be copied from other pricing plans.
- board_price_adults (text): The board price for adults.
- board_price_children_1 (text): The board price for children (1st category).
- board_price_children_2 (text): The board price for children (2nd category).
- board_price_children_3 (text): The board price for children (3rd category).
- different_board_price (text): The status of having different board prices.
- extras (text): The extra details for the pricing plan.

**Response**

The response of this request is a JSON schema representing the structure of the response data.

**Request body** (`raw`)

```json
{
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "name": "Super Pricing",
  "type": "daily",
  "vpid": "370",
  "variation_amount": "0",
  "variation_type": "-2",
  "id_policies": "93",
  "booking_engine": "1",
  "board": "837",
  "restriction_plan": "193",
  "description": "",
  "copy": "0",
  "parent_id": "370",
  "id_properties": "93",
  "periods": [
    {
      "dfrom": "2024-03-19",
      "dto": "2024-03-21",
      "periods": [
        {
          "room_id": "170",
          "room_price": "95"
        },
        {
          "room_id": "172",
          "room_price": "60"
        },
        {
          "room_id": "174",
          "room_price": "57"
        },
        {
          "room_id": "175",
          "room_price": "70"
        },
        {
          "room_id": "4351",
          "room_price": "100"
        },
        {
          "room_id": "4352",
          "room_price": "100"
        },
        {
          "room_id": "4429",
          "room_price": "100"
        },
        {
          "room_id": "4974",
          "room_price": "100"
        },
        {
          "room_id": "6396",
          "room_price": "100"
        },
        {
          "room_id": "6397",
          "room_price": "100"
        },
        {
          "room_id": "6400",
          "room_price": "100"
        },
        {
          "room_id": "6405",
          "room_price": "100"
        },
        {
          "room_id": "6413",
          "room_price": "100"
        },
        {
          "room_id": "6415",
          "room_price": "100"
        },
        {
          "room_id": "6416",
          "room_price": "100"
        },
        {
          "room_id": "6417",
          "room_price": "100"
        },
        {
          "room_id": "6418",
          "room_price": "100.789"
        },
        {
          "room_id": "6419",
          "room_price": "1"
        },
        {
          "room_id": "6420",
          "room_price": "100"
        },
        {
          "room_id": "6421",
          "room_price": "100"
        },
        {
          "room_id": "6422",
          "room_price": "100"
        },
        {
          "room_id": "6423",
          "room_price": "100"
        },
        {
          "room_id": "6424",
          "room_price": "100"
        },
        {
          "room_id": "6432",
          "room_price": "100"
        },
        {
          "room_id": "6433",
          "room_price": "100"
        },
        {
          "room_id": "6434",
          "room_price": "100"
        },
        {
          "room_id": "6435",
          "room_price": "100"
        },
        {
          "room_id": "6436",
          "room_price": "100"
        },
        {
          "room_id": "6439",
          "room_price": "100"
        },
        {
          "room_id": "6440",
          "room_price": "100"
        },
        {
          "room_id": "6441",
          "room_price": "100"
        },
        {
          "room_id": "6442",
          "room_price": "100"
        },
        {
          "room_id": "6443",
          "room_price": "100"
        },
        {
          "room_id": "6444",
          "room_price": "100"
        },
        {
          "room_id": "6445",
          "room_price": "100"
        },
        {
          "room_id": "6446",
          "room_price": "100"
        },
        {
          "room_id": "7379",
          "room_price": "100"
        },
        {
          "room_id": "7380",
          "room_price": "100"
        },
        {
          "room_id": "12699",
          "room_price": "100"
        }
      ]
    }
  ],
  "release_period": "0",
  "release_period_active": "0",
  "prices_per_person_active": 1,
  "prices_per_person": [],
  "inherit_price_id_pricing_plans": "0",
  "locked_price": "0",
  "copy_pricing_plans_items": [],
  "board_price_adults": "0",
  "board_price_children_1": "0",
  "board_price_children_2": "0",
  "board_price_children_3": "0",
  "different_board_price": "0",
  "extras": []
}
```

**Example response — Insert pricing plan** `400 Bad Request`

```html
Pricing plan with this name already exists
```

---

### Edit pricing plan <a id="edit-pricing-plan"></a>

`POST` `https://app.otasync.me/api/pricingPlan/edit/pricing_plan`

**Edit Pricing Plan**

Edit a daily or virtual pricing plan.

- HTTP Method: POST
- Base URL: `https://app.otasync.me/api/pricingPlan/edit/pricing_plan`

**Request Body**

- Type: Raw (application/json)
  - `key`: (string) The key for authentication
  - `token`: (string) The authentication token
  - `name`: (string) The name of the pricing plan
  - `id_pricing_plans`: (number) The ID of the pricing plan
  - `type`: (string) The type of the pricing plan
  - `vpid`: (string) The virtual pricing plan ID
  - `variation_amount`: (string) The variation amount
  - `variation_type`: (string) The variation type
  - `id_policies`: (string) The ID of the policies
  - `booking_engine`: (string) The booking engine
  - `board`: (string) The board
  - `restriction_plan`: (string) The restriction plan
  - `description`: (string) The description
  - `copy`: (string) Copy flag
  - `parent_id`: (string) The parent ID
  - `id_properties`: (string) The ID of the properties
  - `periods`: (array) Array of periods
    - `dfrom`: (string) Start date of the period
    - `dto`: (string) End date of the period
    - `periods`: (array) Array of periods
      - `room_id`: (string) The room ID
      - `room_price`: (string) The room price
  - `release_period`: (string) Release period
  - `release_period_active`: (string) Release period active flag
  - `prices_per_person_active`: (number) Prices per person active flag
  - `prices_per_person`: (array) Array of prices per person
  - `inherit_price_id_pricing_plans`: (string) Inherit price flag
  - `locked_price`: (string) Locked price flag
  - `copy_pricing_plans_items`: (array) Array of copied pricing plan items
  - `board_price_adults`: (string) Board price for adults
  - `board_price_children_1`: (string) Board price for children (1)
  - `board_price_children_2`: (string) Board price for children (2)
  - `board_price_children_3`: (string) Board price for children (3)
  - `different_board_price`: (string) Different board price flag
  - `extras`: (array) Array of extras

**Response (JSON Schema)**

The response of this request is not available.

**Request body** (`raw`)

```json
{
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "name": "Test fixed",
  "id_pricing_plans": 11029,
  "type": "daily",
  "vpid": "370",
  "variation_amount": "0",
  "variation_type": "-2",
  "id_policies": "93",
  "booking_engine": "1",
  "board": "837",
  "restriction_plan": "193",
  "description": "",
  "copy": "0",
  "parent_id": "370",
  "id_properties": "93",
  "periods": [
    {
      "dfrom": "2024-03-19",
      "dto": "2024-03-21",
      "periods": [
        {
          "room_id": "170",
          "room_price": "95"
        },
        {
          "room_id": "172",
          "room_price": "60"
        },
        {
          "room_id": "174",
          "room_price": "57"
        },
        {
          "room_id": "175",
          "room_price": "70"
        },
        {
          "room_id": "4351",
          "room_price": "100"
        },
        {
          "room_id": "4352",
          "room_price": "100"
        },
        {
          "room_id": "4429",
          "room_price": "100"
        },
        {
          "room_id": "4974",
          "room_price": "100"
        },
        {
          "room_id": "6396",
          "room_price": "100"
        },
        {
          "room_id": "6397",
          "room_price": "100"
        },
        {
          "room_id": "6400",
          "room_price": "100"
        },
        {
          "room_id": "6405",
          "room_price": "100"
        },
        {
          "room_id": "6413",
          "room_price": "100"
        },
        {
          "room_id": "6415",
          "room_price": "100"
        },
        {
          "room_id": "6416",
          "room_price": "100"
        },
        {
          "room_id": "6417",
          "room_price": "100"
        },
        {
          "room_id": "6418",
          "room_price": "100.789"
        },
        {
          "room_id": "6419",
          "room_price": "1"
        },
        {
          "room_id": "6420",
          "room_price": "100"
        },
        {
          "room_id": "6421",
          "room_price": "100"
        },
        {
          "room_id": "6422",
          "room_price": "100"
        },
        {
          "room_id": "6423",
          "room_price": "100"
        },
        {
          "room_id": "6424",
          "room_price": "100"
        },
        {
          "room_id": "6432",
          "room_price": "100"
        },
        {
          "room_id": "6433",
          "room_price": "100"
        },
        {
          "room_id": "6434",
          "room_price": "100"
        },
        {
          "room_id": "6435",
          "room_price": "100"
        },
        {
          "room_id": "6436",
          "room_price": "100"
        },
        {
          "room_id": "6439",
          "room_price": "100"
        },
        {
          "room_id": "6440",
          "room_price": "100"
        },
        {
          "room_id": "6441",
          "room_price": "100"
        },
        {
          "room_id": "6442",
          "room_price": "100"
        },
        {
          "room_id": "6443",
          "room_price": "100"
        },
        {
          "room_id": "6444",
          "room_price": "100"
        },
        {
          "room_id": "6445",
          "room_price": "100"
        },
        {
          "room_id": "6446",
          "room_price": "100"
        },
        {
          "room_id": "7379",
          "room_price": "100"
        },
        {
          "room_id": "7380",
          "room_price": "100"
        },
        {
          "room_id": "12699",
          "room_price": "100"
        }
      ]
    }
  ],
  "release_period": "0",
  "release_period_active": "0",
  "prices_per_person_active": 1,
  "prices_per_person": [],
  "inherit_price_id_pricing_plans": "0",
  "locked_price": "0",
  "copy_pricing_plans_items": [],
  "board_price_adults": "0",
  "board_price_children_1": "0",
  "board_price_children_2": "0",
  "board_price_children_3": "0",
  "different_board_price": "0",
  "extras": []
}
```

---

## Property <a id="property"></a>

### Get property info <a id="get-property-info"></a>

`POST` `https://app.otasync.me/api/property/data/property`

**Property Data Endpoint**

This endpoint allows the user to send property data via an HTTP POST request.

**Request Body**

- `token` (string): The authentication token for accessing the API.
- `key` (string): The key for accessing the property data.
- `id_properties` (integer): The ID of the property for which the data is being sent.

**Response**

The response for this request follows the JSON schema below:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "The status of the request, indicating success or failure."
    },
    "message": {
      "type": "string",
      "description": "A message providing additional information about the request status."
    }
  }
}
```

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `HTTP_ORIGIN` | `wasdasd` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "c8222af67ad1b05486a985cf3ec3a47d3dadc097",
  "id_properties": 93
}
```

**Example response — Get property info** `200 OK`

```json
{
  "id_properties": 93,
  "name": "Europa Royale Bucharest",
  "shortname": null,
  "description": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Mauris tempor nibh nibh, quis laoreet leo sollicitudin quis. Nunc ipsum nisl, lacinia in sagittis vitae, efficitur sit amet erat. Lorem ipsum dolor sit amet, consectetur adipiscing elit.l",
  "type": "Hotel",
  "email": "avram.pedja@gmail.com",
  "phone": "0649124038",
  "address": "New address",
  "city": "Kotor",
  "zip": "85330",
  "country": "CO",
  "paypal_client_id": null,
  "stripe_public_key": null,
  "stripe_private_key": null,
  "predefined_nights": "0",
  "first_day_in_calendar": "sunday",
  "latitude": "42.4364143095",
  "longitude": "18.7650265767",
  "pib": "03005585",
  "mb": null,
  "bank_account": null,
  "bank_account_2": null,
  "company_name": "Test",
  "iban": null,
  "swift": null,
  "currency": "EUR",
  "currency_cm": "EUR",
  "currency_cm_rate": "1",
  "currency_cm_rate_type": "auto",
  "extras_currency": "EUR",
  "extras_currency_rate": "1",
  "invoice_currency_additional": "EUR",
  "invoice_currency_additional_rate": "1",
  "engine_logo": "https://app.otasync.me/images/property_logo_93.png?v=1705405600",
  "engine_background": "https://app.otasync.me/images/engine_background_93.png?v=1715940045",
  "invoice_logo": "",
  "website": "https://otasync.me",
  "facebook": "https://facebook.com",
  "instagram": "https://instagram.com",
  "youtube": "https://youtube.com",
  "social_media": "whatsapp, viber, telegram",
  "social_media_phone": "9978105839",
  "bookingcom_link": null,
  "airbnb_link": null,
  "welcome_message": null,
  "no_free_units": null,
  "voucher": null,
  "on_reservation": null,
  "url_custom_page": "https://google.com",
  "general_company_address": "",
  "general_email": null,
  "fiscal_id": "ccdlpipjijijlfjihgpglacgifebplmi",
  "avail_checker": 1,
  "fiscal_montenegro_user_code": "bee4ccc8",
  "fiscal_montenegro_ENUIdentifier": "gr653gq542",
  "channex_messages": "0",
  "eturist_tax": 160,
  "flutterwave_secret_key": "FLWSECK_TEST-xxxxxxxx-REDACTED-X",
  "flutterwave_encryption_key": "FLWSECK_TEST-xxxxxxxx-REDACTED",
  "flutterwave_public_key": null,
  "charge_automation_connected": 0,
  "charge_automation_key": "",
  "is_dummy": 0,
  "channex_type": "apartment",
  "open_channel_integration": 0,
  "credit_card_password": "7288edd0fc3ffcbe93a0cf06e3568e28521687bc",
  "rooms_added": 1,
  "terms_and_conditions": null,
  "privacy_policy": null,
  "number_of_contracted_units": null,
  "onboarded_by_role": null,
  "onboarded_by_role_id": null,
  "logo": null,
  "is_deleted": 0,
  "date_deleted": null,
  "is_modified": null,
  "date_modified": null,
  "date_created": "2021-05-06 11:08:33",
  "id_properties_settings": 93,
  "default_languages": "2",
  "default_languages_general": null,
  "theme": "#1B3C66",
  "undo_timer": null,
  "send_email_in_case_of_overbooking": null,
  "show_company_address_on_invoice": null,
  "send_email_for_new_reservations": null,
  "send_email_to_guests": null,
  "border_radius": "1",
  "display_logo_on_engine": 1,
  "number_of_guests": "1",
  "phone_show": 1,
  "address_show": 1,
  "city_show": 1,
  "country_show": 1,
  "credit_card": 1,
  "cvv": 0,
  "payment_required": 1,
  "parking_request": 0,
  "flight_details": 0,
  "check_in_period_from": "00:00",
  "check_in_period_to": "23:00",
  "check_out_time": "10:00",
  "early_check_in_fee": null,
  "late_check_out_fee": null,
  "early_check_in_time": null,
  "late_check_out_time": null,
  "number_of_children": 1,
  "vat_system": 0,
  "use_e_turist": 0,
  "date_format": "dd/mm/yyyy",
  "same_day_reservation_limit": "20:00",
  "show_finance_tab": "1",
  "cents": 1,
  "default_price": "11029",
  "default_first_meal": "none",
  "default_restriction": 193,
  "default_city_tax": 0,
  "use_children_1": 1,
  "use_children_2": 1,
  "use_children_3": 1,
  "use_children_4": 1,
  "use_children_5": 1,
  "use_children_6": 1,
  "use_children_7": 1,
  "use_adults": 1,
  "use_seniors": 0,
  "children_1_age_limit": 4,
  "children_2_age_limit": 5,
  "children_3_age_limit": 8,
  "children_4_age_limit": 10,
  "children_5_age_limit": 13,
  "children_6_age_limit": 16,
  "children_7_age_limit": 18,
  "adults_age_limit": 0,
  "seniors_age_limit": 70,
  "count_children_1_as_adults": 0,
  "count_children_2_as_adults": 0,
  "count_children_3_as_adults": 0,
  "count_children_4_as_adults": 0,
  "count_children_5_as_adults": 0,
  "count_children_6_as_adults": 0,
  "count_children_7_as_adults": 0,
  "show_room_name_as_short": 0,
  "show_separate_check_number": 1,
  "date_created_invoice_services": "1",
  "place_of_issue_invoice": "1",
  "invoice_show_room": 3,
  "show_card_info_print": 0,
  "show_price_per_night_print": 0,
  "engine_show_unavailable_room_types": 1,
  "engine_font": "Gideon Roman",
  "use_google_hotel": 0,
  "use_montenegro_checkin_guests": 0,
  "bids_allow": 1,
  "bids_value": 90,
  "invoice_group_service": 0,
  "invoice_group_services": 0,
  "add_guests_to_note_invoice": 0,
  "cleaning_period": 0,
  "auto_clean_rooms": 1,
  "disable_auto_assign_rooms": 0,
  "invoice_group_pos_services": 1,
  "days_before_remind_offer": "0",
  "guest_check_out_invoice": "none",
  "use_do_not_disturbe": 0,
  "show_id_reservations_on_invoice": "0",
  "show_taxpayer_and_invoice_is_valid": 0,
  "checkout_by_status": 0,
  "allow_bookings_until": "none",
  "property_category": 0,
  "bed_linen": 0,
  "set_invoice_as_paid_after_fiscal": 0,
  "add_note_to_fiscal_serbia_PDF": 0,
  "invoice_default_note": null,
  "proforma_invoice_default_note": null,
  "advanced_invoice_default_note": null,
  "storned_invoice_default_note": null,
  "storn_advance_default_note": null,
  "storned_proforma_default_note": null,
  "e_faktura_default_note": null,
  "send_reviews_channex": 0,
  "reservations_print_footer": "",
  "default_room_status": "clean",
  "check_previous_res_room_status_left": 0,
  "supervisor": "0",
  "start_stop": "0",
  "separate_number": 1,
  "compare_
```

_(response truncated — original length 11.153 characters)_

---

### Edit property info <a id="edit-property-info"></a>

`POST` `https://app.otasync.me/api/property/edit/property`

**Update Property Details**

This endpoint allows you to update the details of a property.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_properties` (number): The ID of the property to be updated.
- `item` (string): The specific detail to be updated. Possible values include:
  - name
  - description
  - address
  - city
  - phone
  - email
  - website
  - facebook
  - instagram
  - youtube
  - url_custom_page
  - longitude
  - latitude
  - welcome_message
  - no_free_units
  - voucher
  - on_reservation
  - predefined_nights
  - pib
  - mb
  - bank_account
  - bank_account_2
  - iban
  - swift
  - type
  - company_name
  - country
  - currency
  - engine_logo
  - engine_background
- `value` (string): The new value for the specified detail.

**Response Body**

The response will include the updated property details.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `HTTP_ORIGIN` | `wasdasd` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "c8222af67ad1b05486a985cf3ec3a47d3dadc097",
  "id_properties": 93,
  "item": "address",
  "value": "New address"
}
```

**Example response — Edit property info** `201 Created`

_(empty response body)_

---

### Facilities <a id="facilities"></a>

`POST` `https://app.otasync.me/api/property/edit/amenities`

**Property Amenities Edit**

This endpoint allows you to edit the amenities for a specific property.

**Request Body**

- `token` (string): The authentication token.
- `key` (string): The unique key for the request.
- `id_properties` (integer): The ID of the property for which the amenities are being edited.
- `id_amenities` (array of strings): An array of IDs of the amenities to be associated with the property.

**Response**

Upon successful execution, the response will include the updated details of the property amenities.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "c8222af67ad1b05486a985cf3ec3a47d3dadc097",
  "id_properties": 93,
  "id_amenities": [
    "heading",
    "tv-cable",
    "tv-satellite",
    "kitchen",
    "hob",
    "oven",
    "microwave",
    "laundry",
    "teapot",
    "minibar",
    "fridge",
    "internet",
    "private-bathroom",
    "public-parking",
    "private-parking",
    "garage",
    "spa-wellness",
    "city-center",
    "cradle",
    "private-toilet",
    "hair-dryer",
    "shower",
    "tub",
    "jacuzzi",
    "balcony",
    "terrace",
    "sea-view",
    "city-view",
    "mountain-view",
    "pool",
    "sauna",
    "ironing-facility",
    "elevator"
  ]
}
```

**Example response — Facilities** `200 OK`

_(empty response body)_

---

## Restriction plans <a id="restriction-plans"></a>

### Insert restriction plan <a id="insert-restriction-plan"></a>

`POST` `https://app.otasync.me/api/restriction/insert/restriction`

**Add Restriction**

This endpoint allows the user to insert a new restriction for a property.

**Request Body**

- `token` (string): The authentication token.
- `key` (string): The unique key for the restriction.
- `closed` (integer): Indicates if the restriction is closed (1) or open (0).
- `closed_arrival` (integer): Indicates if the restriction is closed on arrival (1) or open (0).
- `closed_departure` (integer): Indicates if the restriction is closed on departure (1) or open (0).
- `max_stay` (integer): The maximum length of stay allowed.
- `min_stay` (integer): The minimum length of stay allowed.
- `min_stay_arrival` (integer): The minimum length of stay allowed on arrival.
- `name` (string): The name of the new restriction plan.
- `type` (string): The type of restriction plan (e.g., daily, weekly).
- `id_properties` (integer): The ID of the property for which the restriction is being added.

**Response**

The response will contain the status of the request, along with any relevant error or success messages.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "2718388b3a579e4fd96764b640042522ee2e02c3",
  "closed": 1,
  "closed_arrival": 1,
  "closed_departure": 0,
  "max_stay": 0,
  "min_stay": 0,
  "min_stay_arrival": 0,
  "name": "New rest plan",
  "type": "daily",
  "id_properties": 93
}
```

---

### Update restriction plan <a id="update-restriction-plan"></a>

`POST` `https://app.otasync.me/api/restriction/edit/restriction`

**Edit Restriction**

This endpoint allows the user to edit a restriction plan.

**Request Body**

- token (string): The authentication token for the user.
- key (string): The key for the restriction plan.
- id_restriction_plans (integer): The ID of the restriction plan to be edited.
- closed (integer): Indicates if the restriction is closed (1 for true, 0 for false).
- closed_arrival (integer): Indicates if the arrival restriction is closed (1 for true, 0 for false).
- closed_departure (integer): Indicates if the departure restriction is closed (1 for true, 0 for false).
- max_stay (integer): The maximum stay allowed.
- min_stay (integer): The minimum stay allowed.
- min_stay_arrival (integer): The minimum stay allowed for arrival.
- type (string): The type of the restriction plan.
- name (string): The name of the new restriction plan.
- id_properties (integer): The ID of the property for which the restriction plan is being edited.

**Response (JSON Schema)**

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  }
}
```

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "2718388b3a579e4fd96764b640042522ee2e02c3",
  "id_restriction_plans": 834,
  "closed": 1,
  "closed_arrival": 1,
  "closed_departure": 0,
  "max_stay": 0,
  "min_stay": 0,
  "min_stay_arrival": 0,
  "type": "daily",
  "name": "New rest plan 2",
  "id_properties": 93
}
```

---

### Get restriction plans <a id="get-restriction-plans"></a>

`POST` `https://app.otasync.me/api/restriction/data/restrictions`

**Restrictions Data API**

This API endpoint is used to submit restrictions data to the app.otasync.me platform.

**Request Body**

- token (string): The authentication token for the request.
- key (string): The key for accessing the restrictions data.
- id_properties (integer): The identifier for the properties.

**Response**

The response for this request follows the JSON schema below:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "restriction_id": {
          "type": "integer"
        },
        "timestamp": {
          "type": "string",
          "format": "date-time"
        }
      }
    }
  }
}
```

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93
}
```

**Example response — Get restriction plans** `200 OK`

```json
[
  {
    "id_restriction_plans": "193",
    "id_properties": "93",
    "name": "Osnovne restrikcije",
    "type": "daily",
    "closed": "0",
    "closed_arrival": "0",
    "closed_departure": "0",
    "max_stay": "0",
    "min_stay": "0",
    "min_stay_arrival": "0",
    "date_created": "2021-05-06 11:08:34"
  },
  {
    "id_restriction_plans": "195",
    "id_properties": "93",
    "name": "SEZONA2",
    "type": "daily",
    "closed": "0",
    "closed_arrival": "0",
    "closed_departure": "0",
    "max_stay": "0",
    "min_stay": "0",
    "min_stay_arrival": "0",
    "date_created": "2021-05-06 11:08:34"
  },
  {
    "id_restriction_plans": "9467",
    "id_properties": "93",
    "name": "New restriction HM",
    "type": "daily",
    "closed": "1",
    "closed_arrival": "1",
    "closed_departure": "0",
    "max_stay": "0",
    "min_stay": "0",
    "min_stay_arrival": "0",
    "date_created": "2024-09-13 14:44:05"
  }
]
```

---

### Get restriction plan <a id="get-restriction-plan"></a>

`POST` `https://app.otasync.me/api/restriction/data/restriction`

**POST /restriction/data/restriction**

This endpoint is used to submit restriction data to the OTAsync application.

**Request Body**

- token (string): The authentication token for the request.
- key (string): The key for the request.
- id_properties (integer): The ID of the properties for which the restriction data is being submitted.
- id_restriction_plans (integer): The ID of the restriction plans associated with the properties.

**Response**

The response for this request follows the JSON schema below:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "The status of the request, indicating success or failure."
    },
    "message": {
      "type": "string",
      "description": "A message providing additional information about the request status."
    }
  }
}
```

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_restriction_plans": 195
}
```

**Example response — Get restriction plan** `200 OK`

```json
{
  "id_restriction_plans": "195",
  "id_properties": "93",
  "name": "SEZONA2",
  "type": "daily",
  "closed": "0",
  "closed_arrival": "0",
  "closed_departure": "0",
  "max_stay": "0",
  "min_stay": "0",
  "min_stay_arrival": "0",
  "date_created": "2021-05-06 11:08:34"
}
```

---

### Delete restriction plan <a id="delete-restriction-plan"></a>

`POST` `https://app.otasync.me/api/restriction/delete/restriction`

This endpoint allows you to delete a specific restriction by making an HTTP POST request to the specified URL. The request should include a JSON payload in the raw request body, containing the token for authentication, key for authorization, id_properties, and id_restriction_plans to identify the restriction to be deleted.

The response will include the outcome of the deletion operation, with appropriate status codes and any relevant data pertaining to the deleted restriction.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_restriction_plans": 834
}
```

**Example response — Delete restriction plan** `200 OK`

```json
{
  "id_restriction_plans": 834
}
```

---

## Restrictions <a id="restrictions"></a>

### Get restrictions <a id="get-restrictions"></a>

`POST` `https://app.otasync.me/api/restrictions/data/restrictions`

**Request**

- Method: POST
- URL: `https://app.otasync.me/api/restrictions/data/restrictions`
- Description: This endpoint is used to retrieve restrictions of each room type for the specified date range.
- Body:
  - token (text): The authentication token for the request.
  - key (text): The key for the request.
  - id_properties (text): The ID of the properties.
  - id_restriction_plans (text): The ID of the restriction plans.
  - dfrom (text): The start date of the date range.
  - dto (text): The end date of the date range.

**Response**

- Content Type: application/json
- { "type": "object", "properties": { "room_type_1": { "type": "object", "properties": { "date_1": { "type": "number" }, "date_2": { "type": "number" }, ... } }, "room_type_2": { "type": "object", "properties": { "date_1": { "type": "number" }, "date_2": { "type": "number" }, ... } }, ... } }
- Description: The response returns the restrictions of each room type for the specified date range in a JSON schema format, where each room type contains a list of dates with their corresponding restriction values.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_restriction_plans": 193,
  "dfrom": "2022-01-01",
  "dto": "2022-01-10"
}
```

**Example response — Get restrictions** `200 OK`

```json
{
  "status": "ok",
  "data": {
    "170": {
      "2022-01-01": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-02": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-03": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-04": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-05": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-06": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-07": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-08": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-09": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-10": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      }
    },
    "171": {
      "2022-01-01": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-02": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-03": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-04": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-05": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-06": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-07": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-08": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-09": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-10": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      }
    },
    "172": {
      "2022-01-01": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-02": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-03": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-04": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-05": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-06": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-07": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-08": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-09": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-10": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      }
    },
    "173": {
      "2022-01-01": {
        "closed": 0,
        "closed_arrival": 0,
        "closed_departure": 0,
        "max_stay": 0,
        "min_stay": 0,
        "min_stay_arrival": 0
      },
      "2022-01-02": {
        "closed": 0,
        "closed_arrival": 0
```

_(response truncated — original length 152.021 characters)_

---

### Edit restrictions <a id="edit-restrictions"></a>

`POST` `https://newdb.otasync.me/api/restrictions/edit/restrictions`

**Update Room Type Availability**

This endpoint allows updating the availability of room types within a specified date range and restriction plan.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The unique key for the request.
- `id_properties` (string): The ID of the property.
- `id_restriction_plans` (string): The ID of the restriction plan.
- `dfrom` (string): The start date of the availability update.
- `dto` (string): The end date of the availability update.
- `rooms` (array): An array of room type availability updates, each containing:
  - `id_room_types` (string): The ID of the room type.
  - `value` (string): The value by which the availability will be updated.
- `field` (string): The field to be updated, e.g., "max_stay".
- `weekdays` (array): An array of 7 numbers (1/0) representing the days of the week to be updated. Days set to 0 won't be updated.

**Response Body**

The response body will contain the result of the availability update request.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Content-Type` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "d63f67009cca8821d75c385c48564f493002bc0e",
  "id_properties": "93",
  "id_restriction_plans": "193",
  "dfrom": "2022-01-01",
  "dto": "2022-01-10",
  "rooms": [
    {
      "id_room_types": "170",
      "value": "20"
    }
  ],
  "field": "max_stay",
  "weekdays": [
    1,
    1,
    1,
    1,
    1,
    1,
    1
  ]
}
```

---

## Rooms <a id="rooms"></a>

### Get room type <a id="get-room-type"></a>

`POST` `https://app.otasync.me/api/room/data/room`

**Request**

- Method: POST
- Endpoint: `https://app.otasync.me/api/room/data/room`
- Description: This endpoint is used to retrieve data for a single room type.

**Request Body**

- Type: Raw (JSON)
  - `token`: (string) The authentication token for the request.
  - `id_properties`: (string) The ID of the properties.
  - `key`: (string) The key for authentication.
  - `id_room_types`: (integer) The ID of the room type.

**Response**

- { "type": "object", "properties": { "room_type": { "type": "object", "properties": { // properties of the room type } } } }
- Description: This endpoint returns the data for a single room type in the specified format.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "id_properties": "93",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_room_types": 170
}
```

---

### Get room type prices <a id="get-room-type-prices"></a>

`POST` `https://app.otasync.me/api/room/data/prices`

**Request**

This endpoint makes an HTTP POST request to retrieve pricing data for a specific room.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The key for authentication.
- `id_properties` (number): The ID of the property.
- `id_room_types` (number): The ID of the room type.
- `id_pricing_plans` (number): The ID of the pricing plan.
- `dfrom` (string): The start date for the pricing data.
- `dto` (string): The end date for the pricing data.
- `guests` (object): The number of guests, including children and adults.

**Response**

The response for this request is a JSON schema representing the pricing data for the specified room type.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_room_types": 172,
  "id_pricing_plans": 373,
  "dfrom": "2024-12-01",
  "dto": "2024-12-05",
  "guests": {
    "children_1": 2,
    "adults": 1
  }
}
```

**Example response — Get room type prices** `200 OK`

```json
{
  "prices": {
    "2024-12-01": 60,
    "2024-12-02": 60,
    "2024-12-03": 60,
    "2024-12-04": 60,
    "2024-12-05": 60
  },
  "guests": {
    "children_1": 2,
    "adults": 1,
    "children_2": 0,
    "children_3": 0,
    "children_4": 0,
    "children_5": 0,
    "children_6": 0,
    "children_7": 0,
    "seniors": 0
  }
}
```

---

### Get room types with rooms <a id="get-room-types-with-rooms"></a>

`POST` `http://localhost/OTASync-DB/OTASync-DB/api/room/data/room_types_rooms`

**Request**

- Method: POST
- URL: `http://localhost/OTASync-DB/OTASync-DB/api/room/data/room_types_rooms`
- Description: This endpoint is used to retrieve a single room type.
- Headers:
  - Content-Type: application/json
- { "token": "a5666bee05b0fa91afc5c2f56a6cdc ...", "id_properties": "251", "key": "1f10a3888329b8d76ac1e7d411e1b1 ..."}

**Response**

- Content-Type: application/json
- { "type": "object", "properties": { "room_type": { "type": "string" }, "room_details": { "type": "object", "properties": { "id": { "type": "string" }, "name": { "type": "string" }, "description": { "type": "string" } } } }}

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "id_properties": "251",
  "key": "1f10a3888329b8d76ac1e7d411e1b145b9bf1227"
}
```

---

### Edit room status <a id="edit-room-status"></a>

`POST` `https://app.otasync.me/api/room/edit/roomStatus`

**Edit Room Status**

This endpoint allows you to edit the current status of a single room.

**Request Body**

- token (string): The authentication token for the request.
- id_properties (string): The ID of the properties.
- key (string): The key for the request.
- id_rooms (integer): The ID of the room.
- status (string): The new status of the room. Possible values are **clean**, **inspected**, and **dirty**.

**Response Body**

The response body contains the updated status of the room.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "id_properties": "93",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_rooms": 3035,
  "status": "clean"
}
```

**Example response — Edit room status** `200 OK`

```json
{
  "id_rooms": "3035",
  "status": "clean"
}
```

---

### Get room types <a id="get-room-types"></a>

`POST` `https://app.otasync.me/api/room/data/rooms`

**Request**

This endpoint makes an HTTP POST request to retrieve a list of all Room Types for the property. The request body should be in raw JSON format and include the following parameters:

- `token` (string): The authentication token for accessing the API.
- `id_properties` (string): The ID of the property for which the room types are being retrieved.
- `key` (string): A key for authorization.
- `type` (number): A numeric identifier for the request type.
- `details` (string): Additional details for the request.

Example:

````json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdc ...",
  "id_properties": "93",
  "key": "574eb98879eb28d03b21e8a5c1a212 ...",
  "type": 1,
  "details": "1"
}
### Response
The response for this request is a JSON object representing the list of Room Types for the property. Below is a JSON schema representing the structure of the response:
```json
{
  "type": "object",
  "properties": {
    "roomTypes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "capacity": {
            "type": "number"
          },
          "amenities": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": ["id", "name", "description", "capacity", "amenities"]
      }
    }
  },
  "required": ["roomTypes"]
}
````

**Request body** (`raw`)

```json
{
    "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
    "id_properties": "93",
    "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
    "type": 1,
    "details": "1",
}
```

**Example response — Get room types** `200 OK`

```json
[
  {
    "id_room_types": "172",
    "id_properties": "93",
    "name": "1-Bedroom Apartment with Sea Views",
    "type": "apartment",
    "shortname": "TEST",
    "price": "60",
    "avail": "31",
    "occupancy": "100",
    "area": "0",
    "bathrooms": "1",
    "booking_engine": "1",
    "google_vr": "0",
    "description": "",
    "is_virtual": "0",
    "prices_per_person": "0",
    "parent_id": "0",
    "avail_variation": "0",
    "variation_type": "",
    "variation_amount": "0",
    "children_1_amount": "100",
    "children_1_variation_type": "percent",
    "children_2_amount": "100",
    "children_2_variation_type": "percent",
    "children_3_amount": "100",
    "children_3_variation_type": "percent",
    "children_4_amount": "0",
    "children_4_variation_type": null,
    "children_5_amount": "0",
    "children_5_variation_type": null,
    "children_6_amount": "0",
    "children_6_variation_type": null,
    "children_7_amount": "0",
    "children_7_variation_type": null,
    "seniors_amount": "100",
    "seniors_variation_type": "percent",
    "copy_min_stay": "0",
    "copy_max_stay": "0",
    "copy_min_stay_arrival": "0",
    "copy_closed_departure": "0",
    "copy_closed_arrival": "0",
    "copy_closed": "0",
    "generate_ical": "0",
    "linked_room_types_active": "0",
    "linked_room_types_id_parent": "0",
    "is_ota_avail_limitted": "0",
    "ota_avail_limit": "0",
    "min_avail_notification": "0",
    "min_adults": "0",
    "max_adults": "0",
    "min_children": "0",
    "max_children": "0",
    "commission_type": "0",
    "commission": "0",
    "vat_manager_modul": "0",
    "notification_email": "",
    "is_deleted": "0",
    "date_deleted": null,
    "is_modified": "0",
    "date_modified": null,
    "date_created": "2021-05-06 11:08:33",
    "parent_avail": null,
    "channex_id_rt": "5599ee35-271a-4203-ba1d-fcea1a0512a5",
    "roomDetails": {
      "roomNumber": [
        {
          "id_rooms": "327",
          "id_room_types": "172",
          "name": "1",
          "status": "dirty",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3035",
          "id_room_types": "172",
          "name": "66",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3036",
          "id_room_types": "172",
          "name": "67",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3037",
          "id_room_types": "172",
          "name": "68",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3038",
          "id_room_types": "172",
          "name": "69",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3039",
          "id_room_types": "172",
          "name": "70",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3040",
          "id_room_types": "172",
          "name": "71",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3041",
          "id_room_types": "172",
          "name": "72",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3042",
          "id_room_types": "172",
          "name": "73",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3043",
          "id_room_types": "172",
          "name": "74",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3044",
          "id_room_types": "172",
          "name": "75",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3045",
          "id_room_types": "172",
          "name": "76",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3046",
          "id_room_types": "172",
          "name": "77",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3047",
          "id_room_types": "172",
          "name": "78",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3048",
          "id_room_types": "172",
          "name": "79",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3049",
          "id_room_types": "172",
          "name": "80",
          "status": "clean",
          "is_deleted": "0",
          "date_deleted": null,
          "room_date_created": "2021-05-06 11:08:33"
        },
        {
          "id_rooms": "3050",
```

_(response truncated — original length 160.119 characters)_

---

### Insert room type <a id="insert-room-type"></a>

`POST` `https://app.otasync.me/api/room/insert/room`

**Create New Room**

This endpoint allows you to create a new room for a property.

**Request Body**

- `token`: (string) The authentication token.
- `key`: (string) The key for authentication.
- `id_properties`: (string) The ID of the property.
- `name`: (string) The name of the room.
- `shortname`: (string) The short name of the room.
- `type`: (string) The type of the room.
- `price`: (string) The price of the room.
- `avail`: (string) The availability of the room.
- `booking_engine`: (integer) The booking engine for the room.
- `occupancy`: (string) The occupancy of the room.
- `area`: (string) The area of the room.
- `bathrooms`: (string) The number of bathrooms in the room.
- `houserooms`: (array) An array containing the details of the house rooms.
  - `name`: (string) The name of the house room.
  - `beds`: (array) An array containing the details of the beds.
- `room_numbers`: (array) An array containing the room numbers.
- `description`: (string) The description of the room.
- `amenities`: (array) An array containing the amenities of the room.
- `images`: (array) An array containing the images of the room.

**Response**

The response will contain the status of the request along with any relevant data or error messages.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "e5fe4eb551084b5f4ca17ec154d06193c10769cc",
  "id_properties": "93",
  "name": "Test Room 2",
  "shortname": "TR2",
  "type": "room",
  "price": "100",
  "avail": "2",
  "booking_engine": 1,
  "occupancy": "3",
  "area": "100",
  "bathrooms": "1",
  "houserooms": [
    {
      "name": "Living Area",
      "beds": [
        null
      ]
    },
    {
      "name": "Bedroom",
      "beds": [
        "Queen Bed",
        "Double Bed"
      ]
    }
  ],
  "room_numbers": [
    "A",
    "B"
  ],
  "description": "Description",
  "amenities": [
    "air-conditioning",
    "heading"
  ],
  "images": []
}
```

---

### Get available room types <a id="get-available-room-types"></a>

`POST` `https://app.otasync.me/api/room/data/available_rooms`

**Retrieve Available Rooms**

This endpoint allows you to retrieve a list of all available room types for a specific property.

**Request Body**

- `key` (text): The authentication key for accessing the API.
- `id_properties` (text): The ID of the property for which available rooms are being retrieved.
- `token` (text): The authentication token for accessing the API.
- `dfrom` (text): The start date for the availability search.
- `dto` (text): The end date for the availability search.
- `id_pricing_plans` (text): The ID of the pricing plan to be considered for availability.
- `include_id_reservations` (text): Indicates whether to include reservations in the availability search.
- `exclude_id_rooms` (text): An array of IDs of rooms to be excluded from the availability search.

**Response Body**

The response will contain the list of available room types for the specified property.

**Request body** (`raw`)

```json
{
  "key": "34df0741e0b24bca1fe4b2c3d1a412c24be65aaa",
  "id_properties": 804,
  "token": "8fba58c5d62f576e0ac309b42df176190f84510d",
  "dfrom": "2022-05-21",
  "dto": "2022-05-29",
  "id_pricing_plans": "2292",
  "include_id_reservations": 0,
  "exclude_id_rooms": []
}
```

---

### Get available room types and rooms <a id="get-available-room-types-and-rooms"></a>

`POST` `https://app.otasync.me/api/room/data/available_rooms`

**Retrieve Available Rooms**

This endpoint allows you to retrieve a list of available room types for a specific property.

**Request Body**

- `key`: *(string)* The authentication key for accessing the API.
- `id_properties`: *(integer)* The ID of the property for which available rooms are being retrieved.
- `token`: *(string)* The authentication token for accessing the API.
- `dfrom`: *(string)* The start date for the availability search in the format 'YYYY-MM-DD'.
- `dto`: *(string)* The end date for the availability search in the format 'YYYY-MM-DD'.
- `id_pricing_plans`: *(string)* The ID of the pricing plan for which available rooms are being retrieved.
- `include_id_reservations`: *(integer)* Flag to include ID reservations in the response.
- `exclude_id_rooms`: *(array)* Array of room IDs to be excluded from the response.

**Response Body**

The response will include a list of available room types for the specified property.

**Request body** (`raw`)

```json
{
  "key": "34df0741e0b24bca1fe4b2c3d1a412c24be65aaa",
  "id_properties": 804,
  "token": "8fba58c5d62f576e0ac309b42df176190f84510d",
  "dfrom": "2022-05-21",
  "dto": "2022-05-29",
  "id_pricing_plans": "2292",
  "include_id_reservations": 0,
  "exclude_id_rooms": []
}
```

---

### Get available rooms <a id="get-available-rooms"></a>

`POST` `https://app.otasync.me/api/room/data/available_rooms`

**Request**

- Method: POST
- URL: `https://app.otasync.me/api/room/data/available_rooms`
- Description: This endpoint returns a list of all available rooms based on the provided parameters.

**Request Body**

- Type: Raw (application/json)
- Attributes:
  - `token`: (string) The authentication token for accessing the API.
  - `id_properties`: (string) The ID of the property for which available rooms are being requested.
  - `key`: (string) The key for accessing the API.
  - `dfrom`: (string) The start date for the availability check.
  - `dto`: (string) The end date for the availability check.
  - `id_room_types`: (number) The ID of the room type.
  - `id_pricing_plans`: (number) The ID of the pricing plan.

**Response**

- Content Type: application/json
- {"type": "object","properties": { "available_rooms": { "type": "array", "items": { "type": "object", "properties": { "room_id": { "type": "number" }, "room_name": { "type": "string" }, "availability": { "type": "string" }, "price": { "type": "number" } } } }}}
- Description: The response will contain an array of available rooms with their IDs, names, availability status, and prices.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "id_properties": "93",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "dfrom": "2022-06-01",
  "dto": "2022-06-02",
  "id_room_types": 170,
  "id_pricing_plans": 370
}
```

**Example response — Get available rooms** `200 OK`

```json
{
  "status": "ok",
  "rooms": [
    {
      "name": "AA",
      "id_room_types": "170",
      "id_rooms": "323"
    },
    {
      "name": "2A3",
      "id_room_types": "170",
      "id_rooms": "324"
    },
    {
      "name": "2",
      "id_room_types": "170",
      "id_rooms": "2971"
    },
    {
      "name": "3",
      "id_room_types": "170",
      "id_rooms": "2972"
    },
    {
      "name": "4",
      "id_room_types": "170",
      "id_rooms": "2973"
    },
    {
      "name": "5",
      "id_room_types": "170",
      "id_rooms": "2974"
    },
    {
      "name": "6",
      "id_room_types": "170",
      "id_rooms": "2975"
    },
    {
      "name": "7",
      "id_room_types": "170",
      "id_rooms": "2976"
    },
    {
      "name": "8",
      "id_room_types": "170",
      "id_rooms": "2977"
    },
    {
      "name": "9",
      "id_room_types": "170",
      "id_rooms": "2978"
    },
    {
      "name": "10",
      "id_room_types": "170",
      "id_rooms": "2979"
    },
    {
      "name": "11",
      "id_room_types": "170",
      "id_rooms": "2980"
    },
    {
      "name": "12",
      "id_room_types": "170",
      "id_rooms": "2981"
    },
    {
      "name": "13",
      "id_room_types": "170",
      "id_rooms": "2982"
    },
    {
      "name": "14",
      "id_room_types": "170",
      "id_rooms": "2983"
    },
    {
      "name": "15",
      "id_room_types": "170",
      "id_rooms": "2984"
    },
    {
      "name": "16",
      "id_room_types": "170",
      "id_rooms": "2985"
    },
    {
      "name": "17",
      "id_room_types": "170",
      "id_rooms": "2986"
    },
    {
      "name": "18",
      "id_room_types": "170",
      "id_rooms": "2987"
    },
    {
      "name": "19",
      "id_room_types": "170",
      "id_rooms": "2988"
    },
    {
      "name": "20",
      "id_room_types": "170",
      "id_rooms": "2989"
    },
    {
      "name": "21",
      "id_room_types": "170",
      "id_rooms": "2990"
    },
    {
      "name": "22",
      "id_room_types": "170",
      "id_rooms": "2991"
    },
    {
      "name": "23",
      "id_room_types": "170",
      "id_rooms": "2992"
    },
    {
      "name": "24",
      "id_room_types": "170",
      "id_rooms": "2993"
    },
    {
      "name": "25",
      "id_room_types": "170",
      "id_rooms": "2994"
    },
    {
      "name": "26",
      "id_room_types": "170",
      "id_rooms": "2995"
    },
    {
      "name": "27",
      "id_room_types": "170",
      "id_rooms": "2996"
    },
    {
      "name": "28",
      "id_room_types": "170",
      "id_rooms": "2997"
    },
    {
      "name": "29",
      "id_room_types": "170",
      "id_rooms": "2998"
    },
    {
      "name": "30",
      "id_room_types": "170",
      "id_rooms": "2999"
    },
    {
      "name": "31",
      "id_room_types": "170",
      "id_rooms": "3000"
    },
    {
      "name": "32",
      "id_room_types": "170",
      "id_rooms": "3001"
    },
    {
      "name": "34",
      "id_room_types": "170",
      "id_rooms": "3003"
    },
    {
      "name": "35",
      "id_room_types": "170",
      "id_rooms": "3004"
    }
  ],
  "prices": null,
  "occupancy": "50",
  "children_prices": {
    "children_1_amount": "100",
    "children_1_variation_type": "percent",
    "children_2_amount": "100",
    "children_2_variation_type": "percent",
    "children_3_amount": "100",
    "children_3_variation_type": "percent",
    "children_4_amount": "0",
    "children_4_variation_type": null,
    "children_5_amount": "0",
    "children_5_variation_type": null,
    "children_6_amount": "0",
    "children_6_variation_type": null,
    "children_7_amount": "0",
    "children_7_variation_type": null,
    "seniors_amount": "100",
    "seniors_variation_type": "percent",
    "prices_per_person": "0"
  },
  "prices_per_person": []
}
```

---

### Get out of services <a id="get-out-of-services"></a>

`POST` ``

**Add Request and Response Description**

This endpoint makes an HTTP POST request to the specified URL. The request body should be in raw format and include the following parameters:

- `token`: A token string
- `id_properties`: An ID for properties
- `key`: A key string
- `dfrom`: The start date in the format 'YYYY-MM-DD'
- `dto`: The end date in the format 'YYYY-MM-DD'
- `id_room_types`: An ID for room types
- `id_pricing_plans`: An ID for pricing plans

The response to this request will include the relevant data based on the provided parameters.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "id_properties": "93",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "dfrom": "2022-06-01",
  "dto": "2022-06-02",
  "id_room_types": 170,
  "id_pricing_plans": 370
}
```

---

### Change room status <a id="change-room-status"></a>

`POST` `https://app.otasync.me/api/room/edit/roomStatus`

**Edit Room Status**

This endpoint allows you to edit the status of a room.

**Request Body**

- `token` (string): The authentication token for the user.
- `id_properties` (string): The ID of the property.
- `key` (string): A unique key for authorization.
- `id_rooms` (number): The ID of the room to be edited.
- `status` (string): The new status of the room ("dirty", "clean", etc.).

**Response**

The response will include the updated status of the room.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "id_properties": "93",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_rooms": 11142,
  "status": "dirty"
}
```

**Example response — Change room status** `200 OK`

```json
{
  "id_rooms": "11142",
  "status": "dirty"
}
```

---

### Edit room type <a id="edit-room-type"></a>

`POST` `https://app.otasync.me/api/room/edit/room`

This endpoint allows you to edit a room by sending an HTTP POST request to [https://app.otasync.me/api/room/edit/room](https://app.otasync.me/api/room/edit/room). The request should include the following parameters in the raw request body:

- `token` (String): The authentication token for the request.
- `key` (String): The key for the request.
- `id_properties` (String): The ID of the properties associated with the room.
- `id_room_types` (Number): The ID of the room type.
- `name` (String): The name of the room.
- `shortname` (String): The short name or code for the room.
- `type` (String): The type of the room.
- `price` (String): The price of the room.
- `avail` (String): The availability of the room.
- `booking_engine` (Number): The booking engine associated with the room.
- `occupancy` (String): The occupancy of the room.
- `area` (String): The area of the room.
- `bathrooms` (String): The number of bathrooms in the room.
- `houserooms` (Array): An array of objects containing the name and beds information for different areas in the room.
- `room_numbers` (Array): An array of room numbers associated with the room.
- `description` (String): The description of the room.
- `amenities` (Array): An array of amenities available in the room.
- `images` (Array): An array of images associated with the room.

The response to this request will contain the updated information for the edited room.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "e5fe4eb551084b5f4ca17ec154d06193c10769cc",
  "id_properties": "93",
  "id_room_types": 12699,
  "name": "Test Room 12",
  "shortname": "TR12",
  "type": "room",
  "price": "100",
  "avail": "2",
  "booking_engine": 1,
  "occupancy": "3",
  "area": "100",
  "bathrooms": "1",
  "houserooms": [
    {
      "name": "Living Area",
      "beds": [
        null
      ]
    },
    {
      "name": "Bedroom",
      "beds": [
        "Queen Bed",
        "Double Bed"
      ]
    }
  ],
  "room_numbers": [
    "A",
    "B"
  ],
  "description": "Description",
  "amenities": [
    "air-conditioning",
    "heading"
  ],
  "images": []
}
```

**Example response — Edit room type** `200 OK`

```json
{
  "id_room_types": 12699,
  "id_changelog": 12231099
}
```

---

## Policies <a id="policies"></a>

### Insert policy <a id="insert-policy"></a>

`POST` `https://app.otasync.me/api/policies/insert/policy`

**Insert Policy**

This endpoint allows you to insert a new policy.

**Request**

- Method: POST
- Endpoint: `https://app.otasync.me/api/policies/insert/policy`
- Body:
  - key (text, required): The key for authentication.
  - id_properties (text, required): The ID properties for the policy.
  - name (text, required): The name of the policy.
  - type (text, required): The type of the policy.
  - amount (text, required): The amount associated with the policy.
  - enableFreeDays (text, required): Indicates if free days are enabled for the policy.
  - freeDays (text, required): The number of free days allowed.
  - description (text, required): Description of the policy.

**Response**

The response schema for this request is as follows:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  }
}
```

**Request body** (`raw`)

```json
{
  "key": "92b2a5ac3099f564e92cc7923212eab268b5db17",
  "id_properties": "93",
  "name": "Test",
  "type": "firstNight",
  "amount": "0",
  "enableFreeDays": 1,
  "freeDays": "2",
  "description": "In case of cancellation, the guest will be charged the amount of the first night of reservation."
}
```

---

### Get policies <a id="get-policies"></a>

`POST` `https://app.otasync.me/api/policies/data/policies`

**Create Policy Data**

This endpoint allows the user to create policy data by making an HTTP POST request to the specified URL.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The key for accessing the policy data.
- `id_properties` (integer): The ID properties for the policy data.

**Response**

The response to the request will contain the relevant details of the created policy data.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93
}
```

**Example response — Get policies** `200 OK`

```json
[
  {
    "id_policies": 93,
    "id_properties": 93,
    "name": "Default policy",
    "type": "noPenalty",
    "amount": 0,
    "free_days_enabled": 0,
    "free_days": 0,
    "description": "",
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 0,
    "date_modified": null,
    "date_created": "2021-05-06 11:08:33"
  },
  {
    "id_policies": 475,
    "id_properties": 93,
    "name": "Test",
    "type": "firstNight",
    "amount": 0,
    "free_days_enabled": 1,
    "free_days": 2,
    "description": "In case of cancellation, the guest will be charged the amount of the first night of reservation.",
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 1,
    "date_modified": "2023-07-10 16:36:26",
    "date_created": "2021-11-09 11:20:09"
  },
  {
    "id_policies": 476,
    "id_properties": 93,
    "name": "Test",
    "type": "firstNight",
    "amount": 0,
    "free_days_enabled": 1,
    "free_days": 2,
    "description": "In case of cancellation, the guest will be charged the amount of the first night o'f reservation.",
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 1,
    "date_modified": "2022-02-11 11:41:41",
    "date_created": "2021-11-09 11:30:28"
  },
  {
    "id_policies": 2671,
    "id_properties": 93,
    "name": "Test",
    "type": "firstNight",
    "amount": 0,
    "free_days_enabled": 1,
    "free_days": 2,
    "description": "In case of cancellation, the guest will be charged the amount of the first night of reservation.",
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 0,
    "date_modified": null,
    "date_created": "2023-07-05 20:58:11"
  },
  {
    "id_policies": 2672,
    "id_properties": 93,
    "name": "Test",
    "type": "firstNight",
    "amount": 0,
    "free_days_enabled": 1,
    "free_days": 2,
    "description": "In case of cancellation, the guest will be charged the amount of the first night of reservation.",
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 0,
    "date_modified": null,
    "date_created": "2023-07-05 21:03:43"
  },
  {
    "id_policies": 2673,
    "id_properties": 93,
    "name": "Test",
    "type": "firstNight",
    "amount": 0,
    "free_days_enabled": 1,
    "free_days": 2,
    "description": "In case of cancellation, the guest will be charged the amount of the first night of reservation.",
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 0,
    "date_modified": null,
    "date_created": "2023-07-05 21:04:58"
  },
  {
    "id_policies": 2676,
    "id_properties": 93,
    "name": "Test",
    "type": "firstNight",
    "amount": 0,
    "free_days_enabled": 1,
    "free_days": 2,
    "description": "In case of cancellation, the guest will be charged the amount of the first night of reservation.",
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 0,
    "date_modified": null,
    "date_created": "2023-07-06 10:39:47"
  },
  {
    "id_policies": 2709,
    "id_properties": 93,
    "name": "Test",
    "type": "firstNight",
    "amount": 0,
    "free_days_enabled": 1,
    "free_days": 2,
    "description": "In case of cancellation, the guest will be charged the amount of the first night of reservation.",
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 0,
    "date_modified": null,
    "date_created": "2023-07-10 16:31:58"
  },
  {
    "id_policies": 2710,
    "id_properties": 93,
    "name": "Test",
    "type": "firstNight",
    "amount": 0,
    "free_days_enabled": 1,
    "free_days": 2,
    "description": "In case of cancellation, the guest will be charged the amount of the first night of reservation.",
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 0,
    "date_modified": null,
    "date_created": "2023-07-10 16:32:37"
  },
  {
    "id_policies": 6638,
    "id_properties": 93,
    "name": "HOTEL OASIS  policy",
    "type": "firstNight",
    "amount": 0,
    "free_days_enabled": 0,
    "free_days": 0,
    "description": "U slučaju otkazivanja gostu će biti naplaćen prvi dan rezervacije.",
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 0,
    "date_modified": null,
    "date_created": "2024-09-11 12:59:08"
  }
]
```

---

### Edit policy <a id="edit-policy"></a>

`POST` `https://app.otasync.me/api/policies/edit/policy`

**Edit Policy**

This endpoint allows the user to edit a policy by providing the necessary details.

**Request**

- Method: POST
- Endpoint: `https://app.otasync.me/api/policies/edit/policy`
- Headers:
  - Content-Type: application/json
- Body:
  - token (string): The authentication token for the user.
  - key (string): The key for authentication.
  - id_policies (string): The ID of the policy to be edited.
  - id_properties (string): The ID of the property associated with the policy.
  - name (string): The name of the policy.
  - type (string): The type of the policy.
  - amount (string): The amount associated with the policy.
  - enableFreeDays (integer): Indicates if free days are enabled (1 for enabled, 0 for disabled).
  - freeDays (string): The number of free days allowed.
  - description (string): A description of the policy.

**Response**

The response for this request is a JSON schema describing the structure of the response object.

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  }
}
```

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "92b2a5ac3099f564e92cc7923212eab268b5db17",
  "id_policies": "475",
  "id_properties": "93",
  "name": "Test",
  "type": "firstNight",
  "amount": "0",
  "enableFreeDays": 1,
  "freeDays": "2",
  "description": "In case of cancellation, the guest will be charged the amount of the first night of reservation."
}
```

---

### Delete policy <a id="delete-policy"></a>

`POST` `https://app.otasync.me/api/policies/delete/policy`

**Delete Policy**

This endpoint is used to delete a specific policy.

**Request**

- Method: POST
- Endpoint: `https://app.otasync.me/api/policies/delete/policy`
- Headers:
  - Content-Type: application/json
- { "token": "a5666bee05b0fa91afc5c2f56a6cdc ...", "key": "92b2a5ac3099f564e92cc7923212ea ...", "id_policies": "477", "id_properties": "93"}

**Response**

The response for this request is a JSON object with the following schema:

```json
{
  "status": "string",
  "message": "string"
}
```

- `status` (string): Indicates the status of the request, whether it was successful or not.
- `message` (string): Provides a message related to the status of the request, such as success message or error details.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "92b2a5ac3099f564e92cc7923212eab268b5db17",
  "id_policies": "477",
  "id_properties": "93"
}
```

---

### Get policy <a id="get-policy"></a>

`POST` `https://app.otasync.me/api/policies/data/policy`

This endpoint allows you to create a new policy data entry. The request should be sent as an HTTP POST to the specified URL with the following parameters in the request body:

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_policies` (string): The ID of the policy.
- `id_properties` (string): The ID of the properties.

Upon successful submission, the API will return the response with the relevant data for the newly created policy entry.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "92b2a5ac3099f564e92cc7923212eab268b5db17",
  "id_policies": "476",
  "id_properties": "93"
}
```

---

## Webhooks <a id="webhooks"></a>

### Get active webhooks <a id="get-active-webhooks"></a>

`POST` `https://app.otasync.me/api/webhooks/data/webhooks`

**Request**

This endpoint allows you to create a new webhook for a specific property.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The unique key for the webhook.
- `id_properties` (number): The ID of the property for which the webhook is being created.

**Response**

The response of this request is a JSON object conforming to the following schema:

```json
{
  "type": "object",
  "properties": {
    "webhook_id": {
      "type": "string"
    },
    "property_id": {
      "type": "number"
    },
    "url": {
      "type": "string"
    },
    "events": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93
}
```

**Example response — Get active webhooks** `200 OK`

```json
[
  {
    "id_properties": "93",
    "id_webhooks": "5",
    "url": "https://front.bits.org.rs/api/webhook",
    "date_created": "2022-01-25 22:58:50"
  },
  {
    "id_properties": "93",
    "id_webhooks": "17",
    "url": "test@url.com",
    "date_created": "2022-03-15 11:43:36"
  },
  {
    "id_properties": "93",
    "id_webhooks": "44",
    "url": "test@url.com",
    "date_created": "2023-07-10 17:13:35"
  },
  {
    "id_properties": "93",
    "id_webhooks": "45",
    "url": "test@url.com",
    "date_created": "2023-07-10 17:14:43"
  },
  {
    "id_properties": "93",
    "id_webhooks": "46",
    "url": "test@url.com",
    "date_created": "2023-07-10 17:21:08"
  },
  {
    "id_properties": "93",
    "id_webhooks": "47",
    "url": "test@url.com",
    "date_created": "2023-07-10 17:29:38"
  },
  {
    "id_properties": "93",
    "id_webhooks": "48",
    "url": "test@url.com",
    "date_created": "2023-07-11 11:56:27"
  },
  {
    "id_properties": "93",
    "id_webhooks": "49",
    "url": "test@url.com",
    "date_created": "2023-07-14 10:41:55"
  },
  {
    "id_properties": "93",
    "id_webhooks": "50",
    "url": "test@url.com",
    "date_created": "2023-11-14 10:56:50"
  },
  {
    "id_properties": "93",
    "id_webhooks": "51",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint",
    "date_created": "2023-11-19 13:42:13"
  },
  {
    "id_properties": "93",
    "id_webhooks": "52",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint",
    "date_created": "2023-11-19 13:44:36"
  },
  {
    "id_properties": "93",
    "id_webhooks": "53",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2023-11-20 13:13:10"
  },
  {
    "id_properties": "93",
    "id_webhooks": "54",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-05 09:29:19"
  },
  {
    "id_properties": "93",
    "id_webhooks": "55",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-08 08:54:01"
  },
  {
    "id_properties": "93",
    "id_webhooks": "56",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-08 09:11:29"
  },
  {
    "id_properties": "93",
    "id_webhooks": "57",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-08 09:55:34"
  },
  {
    "id_properties": "93",
    "id_webhooks": "58",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-08 14:28:02"
  },
  {
    "id_properties": "93",
    "id_webhooks": "59",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-08 14:28:43"
  },
  {
    "id_properties": "93",
    "id_webhooks": "60",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-08 15:30:09"
  },
  {
    "id_properties": "93",
    "id_webhooks": "61",
    "url": "test@url.com",
    "date_created": "2024-02-09 17:40:58"
  },
  {
    "id_properties": "93",
    "id_webhooks": "62",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-11 12:11:34"
  },
  {
    "id_properties": "93",
    "id_webhooks": "63",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-11 12:11:45"
  },
  {
    "id_properties": "93",
    "id_webhooks": "64",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-12 14:44:54"
  },
  {
    "id_properties": "93",
    "id_webhooks": "65",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-12 14:53:49"
  },
  {
    "id_properties": "93",
    "id_webhooks": "66",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-12 14:55:32"
  },
  {
    "id_properties": "93",
    "id_webhooks": "67",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-12 14:59:35"
  },
  {
    "id_properties": "93",
    "id_webhooks": "83",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-19 09:19:17"
  },
  {
    "id_properties": "93",
    "id_webhooks": "84",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-20 13:52:23"
  },
  {
    "id_properties": "93",
    "id_webhooks": "86",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-22 12:43:49"
  },
  {
    "id_properties": "93",
    "id_webhooks": "87",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-22 12:43:56"
  },
  {
    "id_properties": "93",
    "id_webhooks": "88",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-22 12:45:43"
  },
  {
    "id_properties": "93",
    "id_webhooks": "89",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-22 12:50:28"
  },
  {
    "id_properties": "93",
    "id_webhooks": "90",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-22 15:50:58"
  },
  {
    "id_properties": "93",
    "id_webhooks": "96",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-26 06:09:48"
  },
  {
    "id_properties": "93",
    "id_webhooks": "97",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-26 06:33:35"
  },
  {
    "id_properties": "93",
    "id_webhooks": "98",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-26 12:29:41"
  },
```

_(response truncated — original length 7.560 characters)_

---

### Test webhook <a id="test-webhook"></a>

`POST` `https://app.otasync.me/api/webhooks/data/test_webhook`

**Request**

This endpoint allows you to create a new webhook for a specific property.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The unique key for the webhook.
- `id_properties` (number): The ID of the property for which the webhook is being created.

**Response**

The response of this request is a JSON object conforming to the following schema:

```json
{
  "type": "object",
  "properties": {
    "webhook_id": {
      "type": "string"
    },
    "property_id": {
      "type": "number"
    },
    "url": {
      "type": "string"
    },
    "events": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "data_type": "reservation"
}
```

**Example response — Get active webhooks** `200 OK`

```json
[
  {
    "id_properties": "93",
    "id_webhooks": "5",
    "url": "https://front.bits.org.rs/api/webhook",
    "date_created": "2022-01-25 22:58:50"
  },
  {
    "id_properties": "93",
    "id_webhooks": "17",
    "url": "test@url.com",
    "date_created": "2022-03-15 11:43:36"
  },
  {
    "id_properties": "93",
    "id_webhooks": "44",
    "url": "test@url.com",
    "date_created": "2023-07-10 17:13:35"
  },
  {
    "id_properties": "93",
    "id_webhooks": "45",
    "url": "test@url.com",
    "date_created": "2023-07-10 17:14:43"
  },
  {
    "id_properties": "93",
    "id_webhooks": "46",
    "url": "test@url.com",
    "date_created": "2023-07-10 17:21:08"
  },
  {
    "id_properties": "93",
    "id_webhooks": "47",
    "url": "test@url.com",
    "date_created": "2023-07-10 17:29:38"
  },
  {
    "id_properties": "93",
    "id_webhooks": "48",
    "url": "test@url.com",
    "date_created": "2023-07-11 11:56:27"
  },
  {
    "id_properties": "93",
    "id_webhooks": "49",
    "url": "test@url.com",
    "date_created": "2023-07-14 10:41:55"
  },
  {
    "id_properties": "93",
    "id_webhooks": "50",
    "url": "test@url.com",
    "date_created": "2023-11-14 10:56:50"
  },
  {
    "id_properties": "93",
    "id_webhooks": "51",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint",
    "date_created": "2023-11-19 13:42:13"
  },
  {
    "id_properties": "93",
    "id_webhooks": "52",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint",
    "date_created": "2023-11-19 13:44:36"
  },
  {
    "id_properties": "93",
    "id_webhooks": "53",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2023-11-20 13:13:10"
  },
  {
    "id_properties": "93",
    "id_webhooks": "54",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-05 09:29:19"
  },
  {
    "id_properties": "93",
    "id_webhooks": "55",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-08 08:54:01"
  },
  {
    "id_properties": "93",
    "id_webhooks": "56",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-08 09:11:29"
  },
  {
    "id_properties": "93",
    "id_webhooks": "57",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-08 09:55:34"
  },
  {
    "id_properties": "93",
    "id_webhooks": "58",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-08 14:28:02"
  },
  {
    "id_properties": "93",
    "id_webhooks": "59",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-08 14:28:43"
  },
  {
    "id_properties": "93",
    "id_webhooks": "60",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-08 15:30:09"
  },
  {
    "id_properties": "93",
    "id_webhooks": "61",
    "url": "test@url.com",
    "date_created": "2024-02-09 17:40:58"
  },
  {
    "id_properties": "93",
    "id_webhooks": "62",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-11 12:11:34"
  },
  {
    "id_properties": "93",
    "id_webhooks": "63",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-11 12:11:45"
  },
  {
    "id_properties": "93",
    "id_webhooks": "64",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-12 14:44:54"
  },
  {
    "id_properties": "93",
    "id_webhooks": "65",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-12 14:53:49"
  },
  {
    "id_properties": "93",
    "id_webhooks": "66",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-12 14:55:32"
  },
  {
    "id_properties": "93",
    "id_webhooks": "67",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-12 14:59:35"
  },
  {
    "id_properties": "93",
    "id_webhooks": "83",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-19 09:19:17"
  },
  {
    "id_properties": "93",
    "id_webhooks": "84",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-20 13:52:23"
  },
  {
    "id_properties": "93",
    "id_webhooks": "86",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-22 12:43:49"
  },
  {
    "id_properties": "93",
    "id_webhooks": "87",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-22 12:43:56"
  },
  {
    "id_properties": "93",
    "id_webhooks": "88",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-22 12:45:43"
  },
  {
    "id_properties": "93",
    "id_webhooks": "89",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-22 12:50:28"
  },
  {
    "id_properties": "93",
    "id_webhooks": "90",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-22 15:50:58"
  },
  {
    "id_properties": "93",
    "id_webhooks": "96",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-26 06:09:48"
  },
  {
    "id_properties": "93",
    "id_webhooks": "97",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-26 06:33:35"
  },
  {
    "id_properties": "93",
    "id_webhooks": "98",
    "url": "https://hcm-dev.hyperguest.com/api/hcm/pms/otasync/endpoint/93",
    "date_created": "2024-02-26 12:29:41"
  },
```

_(response truncated — original length 7.560 characters)_

---

### insert webhook <a id="insert-webhook"></a>

`POST` `https://app.otasync.me/api/webhooks/insert/webhook`

**Create a New Webhook**

This endpoint allows you to insert a new webhook for the property. The webhook will send a POST request with data in JSON format to the specified URL when certain actions occur. The request should be made using the HTTP POST method to the following URL: `https://app.otasync.me/api/webhooks/insert/webhook`.

**Request Body**

- `token` (string): The token for authentication.
- `key` (string): The key for authentication.
- `id_properties` (number): The ID of the property.
- `url` (string): The URL to which the webhook will send the POST request.

**Response Body**

The response will contain the status of the request and any relevant information regarding the insertion of the new webhook.

**Webhook Actions**

- New reservation
- Updated reservation
- Updated guest status
- Canceled reservation
- Availability update
- Prices update
- Restrictions update

Each action specifies the `data_type`, `action`, and the `data` to be sent in the POST request when the corresponding event occurs.

For example, when a new reservation is made, the webhook will send a POST request with the `data_type` as "reservation", `action` as "insert", and the entire "reservation" object as the `data`.

When an availability update occurs, the `data_type` will be "avail", the `action` will be "edit", and the updated values will be sent in the `id_room_types => date => value` format as the `data`.

Make sure to handle the incoming POST requests at the specified URL based on the defined actions.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "url": "test@url.com"
}
```

**Example response — insert webhook** `201 Created`

```json
{
  "id_webhooks": 300
}
```

---

### Edit webhook <a id="edit-webhook"></a>

`POST` `https://app.otasync.me/api/webhooks/edit/webhook`

**Update Webhook URL**

This endpoint allows you to update the URL of a webhook.

**Request Body**

- token (string): The authentication token.
- key (string): The key for the webhook.
- id_properties (integer): The ID of the properties.
- url (string): The new URL for the webhook.
- id_webhooks (integer): The ID of the webhook.

**Response Body**

The response contains the updated webhook details.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "url": "new.url.com",
  "id_webhooks": 2
}
```

---

### Delete webhook <a id="delete-webhook"></a>

`POST` `https://app.otasync.me/api/webhooks/delete/webhook`

**Request**

- Method: POST
- URL: `https://app.otasync.me/api/webhooks/delete/webhook`
- Description: Deletes a webhook.
- Body:
  - Type: Raw (application/json)
  - { "token": "a5666bee05b0fa91afc5c2f56a6cdc ...", "key": "574eb98879eb28d03b21e8a5c1a212 ...", "id_properties": 93, "id_webhooks": 3}

**Response**

- { "type": "object", "properties": { "status": { "type": "string" }, "message": { "type": "string" } }}

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_webhooks": 3
}
```

**Example response — Delete webhook** `200 OK`

```json
{
  "id_webhooks": 3
}
```

---

## Statistics <a id="statistics"></a>

### Get statistics table <a id="get-statistics-table"></a>

`POST` `https://app.otasync.me/api/statistics/data/statistics_table`

This endpoint allows you to retrieve statistics table data by making an HTTP POST request to the specified URL. The request body should be in raw format and include the following parameters:

- token (string): A token for authentication.
- key (string): A key for authorization.
- id_properties (integer): The ID of the properties.
- dfrom (string): The start date for the data retrieval.
- dto (string): The end date for the data retrieval.
- filter_by (integer): The filter criteria for the data.

Upon a successful request, the response will include the statistics table data based on the provided parameters.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "dfrom": "2023-03-14",
  "dto": "2023-03-15",
  "filter_by": 1
}
```

**Example response — Get statistics table** `200 OK`

```json
{
  "data": {
    "channels": [
      {
        "avg_income": 0,
        "canceled": 100,
        "canceled_count": 1,
        "commission": "0",
        "confirmed": 0,
        "costs": 0,
        "count": 1,
        "earnings": 0,
        "id": "392",
        "income": 0,
        "logo": "https://app.otasync.me/img/ota/youbook.png",
        "name": "Private reservation",
        "nights": 0
      },
      {
        "avg_income": 114,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "0",
        "confirmed": 1,
        "costs": 0,
        "count": 1,
        "earnings": 114,
        "id": "393",
        "income": 114,
        "logo": "https://app.otasync.me/img/ota/ota_b.png",
        "name": "Booking engine",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "15",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "395",
        "income": 0,
        "logo": "https://wubook.net/imgs/default/channels_airbnb.png",
        "name": "Airbnb",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "18",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "396",
        "income": 0,
        "logo": "https://app.otasync.me/images/channel_544.gif",
        "name": "Expedia",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "18",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "397",
        "income": 0,
        "logo": "https://wubook.net/imgs/default/channels_ostrovok.png",
        "name": "Ostrovok",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "0",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "398",
        "income": 0,
        "logo": "https://app.otasync.me/img/ota/sunhotels.png",
        "name": "SunHotels",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "0",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "399",
        "income": 0,
        "logo": "https://admin.otasync.me//images/1521199571_1605770977.jpg",
        "name": "test",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "20",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "400",
        "income": 0,
        "logo": "https://admin.otasync.me//images/1521199571_1605864535.jpeg",
        "name": "test23",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "2",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "2100",
        "income": 0,
        "logo": "",
        "name": "Bits",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "0",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "2303",
        "income": 0,
        "logo": "",
        "name": "Kanal",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "0",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "2379",
        "income": 0,
        "logo": "",
        "name": "TestKanal",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "0",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "2380",
        "income": 0,
        "logo": "",
        "name": "TestKanal",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "0",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "2381",
        "income": 0,
        "logo": "",
        "name": "TestKanalLaravel",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "0",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "2385",
        "income": 0,
        "logo": "",
        "name": "TestKanalLaravel",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "10",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "4813",
        "income": 0,
        "logo": "",
        "name": "New channel",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "0",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "6448",
        "income": 0,
        "logo": "",
        "name": "Postman API",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "0",
        "confirmed": 0,
        "costs": 0,
        "count": 0,
        "earnings": 0,
        "id": "6499",
        "income": 0,
        "logo": "",
        "name": "NomadStays",
        "nights": 0
      },
      {
        "avg_income": 0,
        "canceled": 0,
        "canceled_count": 0,
        "commission": "0",
```

_(response truncated — original length 19.413 characters)_

---

### average_night <a id="average_night"></a>

`POST` `https://app.otasync.me/api/statistics/data/average_night`

**POST /api/statistics/data/average_night**

This endpoint is used to retrieve the average nightly statistics data.

**Request**

- Method: POST
- Body:
  - token (string, required): The authentication token.
  - key (string, required): The key for accessing the statistics data.
  - id_properties (integer, required): The ID of the properties for which the statistics are requested.
  - compare_year (integer, required): The year to compare the statistics with.

**Response**

The response for this request is a JSON object conforming to the following schema:

```json
{
    "type": "object",
    "properties": {
        "average_night_data": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    // Properties of the average nightly data
                }
            }
        }
    }
}
```

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "compare_year": 2023
}
```

**Example response — average_night** `200 OK`

```json
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
```

---

### occupancy by months <a id="occupancy-by-months"></a>

`POST` `https://app.otasync.me/api/statistics/data/occupancy_by_months`

**Occupancy by Months Data Statistics**

This endpoint allows you to retrieve occupancy statistics data by months. It requires a POST request with the following parameters:

- `token` (string): The authentication token for accessing the API.
- `key` (string): The key for authentication and authorization.
- `id_properties` (integer): The ID of the properties for which the occupancy statistics are requested.
- `dfrom` (string): The start date for the occupancy statistics data.
- `dto` (string): The end date for the occupancy statistics data.
- `filter_by` (integer): The filter criteria for the occupancy statistics.

**Request Body**

The request body should be in raw format and should include the above parameters.

**Response**

The response will include the occupancy statistics data for the specified months.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "dfrom": "2023-03-14",
  "dto": "2023-03-15",
  "filter_by": 1
}
```

**Example response — occupancy by months** `200 OK`

```json
{
  "2024": [
    0.25,
    0,
    0.61,
    0.76,
    0.36,
    0.21,
    0.3,
    0,
    0,
    0,
    0,
    0
  ],
  "2025": [
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
  ]
}
```

---

### Pace report <a id="pace-report"></a>

`POST` `https://app.otasync.me/api/reports/data/paceReport`

**Pace Report Data**

This endpoint allows you to retrieve pace report data by sending a POST request to the specified URL.

**Request Body**

- `token` (string): The authentication token for accessing the API.
- `key` (string): The key for accessing the report data.
- `id_properties` (integer): The ID of the properties for which the report data is being fetched.
- `filter` (string): The filter to be applied to the report data (e.g., "month").
- `event` (string): The event on which the report data is based (e.g., "date_created").
- `days` (string): The time duration for which the report data is requested (e.g., "seven_days").
- `compare_year` (string): The year to be compared for the report data (e.g., "2023").

**Response**

The response to the request will contain the pace report data based on the provided parameters.

**Request body** (`raw`)

```json
{
    "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
    "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
    "id_properties": 93,
     "filter":"month", // day //week
    "event":"date_created", // date_arrival
    "days":"seven_days", 
    "compare_year": "2023"
}
```

**Example response — Pace report** `200 OK`

```json
{
  "2023": {
    "2023-1": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2023-2": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2023-3": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2023-4": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2023-5": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2023-6": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2023-7": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2023-8": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2023-9": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2023-10": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2023-11": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2023-12": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    }
  },
  "2025": {
    "2025-1": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2025-2": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2025-3": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2025-4": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2025-5": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2025-6": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2025-7": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2025-8": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2025-9": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2025-10": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2025-11": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    },
    "2025-12": {
      "nights": 0,
      "adr": 0,
      "total_price": 0
    }
  }
}
```

---

### Guest arrvial channel/ country <a id="guest-arrvial-channel-country"></a>

`POST` `https://app.otasync.me/api/statistics/data/statistics_country_channel`

**API Request Description**

This API endpoint allows you to retrieve statistics data based on country and channel. The HTTP POST request should be sent to `https://app.otasync.me/api/statistics/data/statistics_country_channel`.

**Request Body**

- `token` (string): The authentication token for accessing the statistics data.
- `key` (string): The key for accessing the statistics data.
- `id_properties` (integer): The unique identifier for the properties.
- `type` (string): Specifies the type of statistics data to be retrieved (e.g., channel).
- `days` (string): Specifies the time range for the statistics data (e.g., seven_days).
- `year` (string): Specifies the year for which the statistics data should be retrieved.

**Response**

The response of this request is a JSON object conforming to the following schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        // Properties of the statistics data object
      }
    }
  }
}
```

**Request body** (`raw`)

```json
{
    "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
    "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
    "id_properties": 93,
     "type":"channel", // country
    "days":"seven_days", 
    "year": "2023"
}
```

**Example response — Guest arrvial channel/ country** `200 OK`

```json
[
  {
    "value": 65,
    "name": "Private reservation",
    "logo": "https://app.otasync.me/img/ota/youbook.png"
  },
  {
    "value": 28,
    "name": "Postman API",
    "logo": ""
  },
  {
    "value": 9,
    "name": "Booking engine",
    "logo": "https://app.otasync.me/img/ota/ota_b.png"
  }
]
```

---

### Occupied rooms and paid reservations <a id="occupied-rooms-and-paid-reservations"></a>

`POST` `https://app.otasync.me/api/statistics/data/occupied_room_paid_reservation`

**API Request Description**

This API endpoint allows you to retrieve statistics data based on country and channel. The HTTP POST request should be sent to `https://app.otasync.me/api/statistics/data/statistics_country_channel`.

**Request Body**

- `token` (string): The authentication token for accessing the statistics data.
- `key` (string): The key for accessing the statistics data.
- `id_properties` (integer): The unique identifier for the properties.
- `type` (string): Specifies the type of statistics data to be retrieved (e.g., channel).
- `days` (string): Specifies the time range for the statistics data (e.g., seven_days).
- `year` (string): Specifies the year for which the statistics data should be retrieved.

**Response**

The response of this request is a JSON object conforming to the following schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        // Properties of the statistics data object
      }
    }
  }
}
```

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "dfrom": "2023-03-15",
  "dto": "2023-03-16"
}
```

**Example response — Occupied rooms and paid reservations** `200 OK`

```json
{
  "occupancy": {
    "occupied_percent": 0,
    "occupied_rooms": 0,
    "total_rooms": 127
  },
  "paid": {
    "total_price": 22736.89,
    "paid": 22736.89,
    "paid_percent": 100
  }
}
```

---

### Revenue and paid reservations <a id="revenue-and-paid-reservations"></a>

`POST` `https://app.otasync.me/api/statistics/data/revenue_and_paid`

**POST /api/statistics/data/revenue_and_paid**

This endpoint is used to retrieve revenue and paid statistics data.

**Request**

- Method: POST
- URL: `https://app.otasync.me/api/statistics/data/revenue_and_paid`
- Headers:
  - Content-Type: application/json
- { "token": "a5666bee05b0fa91afc5c2f56a6cdc ...", "key": "574eb98879eb28d03b21e8a5c1a212 ...", "id_properties": 93, "dfrom": "2023-03-14", "dto": "2023-03-14"}

**Response**

The response for this request will be a JSON object with the following schema:

```json
{
  "revenue": {
    "total": "number",
    "details": [
      {
        "date": "string",
        "amount": "number"
      }
    ]
  },
  "paid": {
    "total": "number",
    "details": [
      {
        "date": "string",
        "amount": "number"
      }
    ]
  }
}
```

The response will contain revenue and paid statistics data, including total amounts and details for specific dates.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "dfrom": "2023-03-14",
  "dto": "2023-03-14"
}
```

**Example response — Revenue and paid reservations** `200 OK`

```json
{
  "revenue": {
    "total_revenue": 58.41,
    "currency": "EUR"
  },
  "paid": {
    "paid": 0,
    "currency": "EUR"
  }
}
```

---

### Occupancy <a id="occupancy"></a>

`POST` `https://app.otasync.me/api/statistics/data/occupancy`

**POST /api/statistics/data/occupancy**

This endpoint is used to retrieve occupancy statistics data.

**Request Body**

- token (string): The authentication token for the request.
- key (string): The key for the request.
- id_properties (integer): The ID of the properties for which the occupancy statistics are requested.

**Response**

The response for this request follows the JSON schema below:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        // Add properties based on the actual response
      }
    }
  }
}
```

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93
}
```

**Example response — Occupancy** `200 OK`

```json
{
  "occupancy": {
    "confirmed": {
      "today": "0.00",
      "yesterday": "0.00",
      "last_week": "0.00"
    },
    "canceled": {
      "today": "0.00",
      "yesterday": "0.00",
      "last_week": "0.00"
    },
    "noshow": {
      "today": "0.00",
      "yesterday": "0.00",
      "last_week": "0.00"
    }
  }
}
```

---

## Invoices <a id="invoices"></a>

### Get invoice <a id="get-invoice"></a>

`POST` `https://app.otasync.me/api/invoices/data/invoice`

**Invoice Data Submission API**

This endpoint allows users to submit invoice data to the system. It is designed to process invoice-related information and return the corresponding details.

**Request**

**Method:** POST
**URL:** `https://app.otasync.me/api/invoices/data/invoice`

**Request Body**

The request body should be in JSON format and must include the following parameters:

- `token` (string): A unique token for authentication.
- `id_properties` (string): The identifier for the properties associated with the invoice.
- `key` (string): A unique key for the request.
- `id_invoices` (string): The identifier for the specific invoice being processed.

Example of the request body:

```json
{
  "token": "your_token_here",
  "id_properties": "93",
  "key": "your_key_here",
  "id_invoices": "8755"
}
```

**Response**

Upon a successful request, the API will return a response with a status code of 200. The response will contain the following fields:

- `id_invoices`: The ID of the invoice.
- `id_properties`: The ID of the properties.
- `id_guests`: The number of guests associated with the invoice.
- `link_invoice`: A link to the invoice document (if applicable).
- `invoice_number`: The generated invoice number.
- `date_issued`: The date the invoice was issued.
- `price_total`: The total price of the invoice.
- `payment_method`: The method used for payment.
- `reservation_data`: Contains details about reservations related to the invoice.
- `reservation_rooms`: An array detailing room reservations.
- `invoice_services`: An array containing services associated with the invoice.

Example of the response body:

```json
{
  "id_invoices": 0,
  "id_properties": 0,
  "id_guests": 0,
  "link_invoice": null,
  "invoice_number": 0,
  "date_issued": "",
  "price_total": 0,
  "payment_method": "",
  "reservation_data": {
    "date_arrival": "",
    "date_departure": "",
    "id_reservations": 0
  },
  "reservation_rooms": [],
  "invoice_services": []
}
```

**Notes**

- Ensure that the `token` is valid and has the necessary permissions to access this endpoint.
- The response may contain additional fields that provide further details about the invoice and its associated services.
- If there are any issues with the request, appropriate error messages will be returned to help diagnose the problem.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "id_properties": "93",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_invoices": "8755"
}
```

**Example response — Get invoice** `200 OK`

```json
{
  "id_invoices": 912904,
  "id_properties": 3998,
  "id_reservations": 0,
  "id_conference_halls_bookings": "0",
  "id_spas_bookings": 0,
  "id_guests": 0,
  "link_invoice": 0,
  "advance_link_invoice": 912905,
  "mark": "165-2024",
  "invoice_number": 165,
  "invoice_year": 2024,
  "date_issued": "2024-12-25",
  "date_delivered": "2024-12-25",
  "date_turnover": "2020-11-11",
  "payment_method": "",
  "paid": 1,
  "type": "invoice",
  "name": "FORMAN BGD DOO INDJIJA",
  "pib": "104425516",
  "mb": "20162236",
  "travel_document_number": "1",
  "address": "LAMELA A I B 7B",
  "country": null,
  "city": "Inđija",
  "postal_code": "22320",
  "email": "1",
  "phone": "1",
  "note": "",
  "price_paid": 29250,
  "price_to_pay": 29250,
  "price_total": 29250,
  "split": 0,
  "splitted_by": null,
  "advance_remaining_amount": 0,
  "advance_amount": 0,
  "reservation_holder": "Anton Ećimović",
  "downloaded_fiscal": 0,
  "fiscalized": 1,
  "fiscalized_date": "2024-12-25 17:38:42",
  "fiscalized_user": 5359,
  "id_users": "Jovana Dević",
  "client_type": "1",
  "turnover_of_goods": "2024-12-25",
  "id_companies": "12347",
  "is_merged": 0,
  "reservations_modified": 0,
  "pib_fiscal_type_serbia": "10",
  "fiscal_serbia_optional_buyer_id": 0,
  "fiscal_serbia_optional_buyer_value": "",
  "id_reservations_old": 0,
  "advance_remaining_pay_variation_type": "fixed",
  "advance_remaining_pay_variation_amount": 0,
  "advance_remaining_pay_amount": 0,
  "is_storned": 0,
  "auto_storned": 0,
  "is_dummy": 0,
  "is_deleted": 0,
  "date_deleted": null,
  "is_modified": 0,
  "date_modified": null,
  "date_created": "2024-12-25 17:38:19",
  "city_customer": "INDJIJA",
  "first_name": null,
  "last_name": null,
  "guest_email": null,
  "properties_pib": "101612478",
  "properties_mb": "08369623",
  "properties_bank_account": "205-538480-86",
  "properties_bank_account_2": null,
  "properties_address": "Vojvode Stepe 32",
  "properties_swift": "KOBBRSBG",
  "properties_iban": "RS35205007010060314289",
  "properties_company_name": "MNG Plastik Gogić doo Inđija; Kralja Petra I 227; Inđija; ogranak Hogo",
  "invoice_logo": "",
  "engine_logo": "https://app.otasync.me/images/property_logo_3998.jpeg?v=1729162428",
  "vat_system": 1,
  "reference": null,
  "customer_country": "RS",
  "set_invoice_as_paid_after_fiscal": 0,
  "company_email": "formanbgd@gmail.com",
  "invoiceNumber": "S9XUPYSD-S9XUPYSD-331",
  "invoiceCounter": "161/331ПП",
  "sdcDateTime": "2024-12-25T17:38:42",
  "verificationUrl": "https://suf.purs.gov.rs/v/?vl=A1M5WFVQWVNEUzlYVVBZU0RLAQAAoQAAACAybxEAAAAAAAABk%2F6vTlAAAAwxMDoxMDQ0MjU1MTZXh%2FPrwACtbMtfoQcIhO9RMCXgqNWx77kM1%2BqtDikyq7aYl417xlQ2peASwQaMDSZczc3IONmSlWpTZvykbv3zKHl4R1AuYJids8fgsCjDmuHe7l7E3LXO9VojKfVnuVz8d32Cu0vDI1bALVHARK91YJzaHtPl3fB1%2BXg0Y5kqZbRdKftXlH%2B2fEKVTQ9WerpIC96Q4Q5GVp3dqHrIZsVQOxKMIkYw8PuiYSnxL%2BsrzP9uDLcX6i0ws1N04ojiJmIolqUJN3CmvbWgmlZzr858AmE7IuPOEhfAa4%2F2aVgIOwXgXK4uIqZi6vewCVDx8G3hQPPAFBwYoxuNnxoht8YhpF025EaCesoAFzGderFWDcRlBN9vFqVIlRrtoa%2BOe%2BmaIicO0NaUO8HGBJCiQkEtDeh9skD%2FuwnjXU0zqibGMZkHYV3AosbK0CaWKyEKBweJMgxywcC3ZDbjXCsroKAq89BwUoRTez%2B6KVrKf7Qm%2B7znao0OVhv5GqMgFTP5DRKPm%2FZAc4WqZ5z9XlwftMWOZt9bRkpgliGDikasMnYLigGCO%2BKqypAfvpiDaHFlKGYuiUOhrS9WDK8f8z9L9wnHUX3aJHIsUPuZOEUqqLkavKiQ00KCgs65zUQDdkG%2BSKj3ZpqyEBXSjTyO3xvMGfOZ6uapnblqw7JpZgR6P9Uz%2FA7lhEezSGCyZWhrG6IVDGM%3D",
  "reservation_data": null,
  "reservation_rooms": [],
  "advance_storn_invoice_price_total": 0,
  "advance_storn_invoice_tax_total": 0,
  "advance_storn_invoice_number_serbia": "S9XUPYSD-S9XUPYSD-330",
  "advance_storn_invoice_number_serbia_date_created": "2024-12-25T17:38:41",
  "advance_invoice_date_issued": "2024-11-25",
  "storn_invoice_number_serbia": null,
  "storn_invoice_number_serbia_date_created": null,
  "storn_invoice_number_bih": null,
  "invoice_services": [
    {
      "id_invoices_services": 1340367,
      "id_invoices": 912904,
      "id_extras": 43983,
      "name": "Silver SPA članska karta",
      "quantity": 1,
      "price_per_unit": 29250,
      "tax": 20,
      "paid": 0,
      "payment_method": null,
      "discount_type": "percent",
      "discount_amount": 0,
      "total_without_tax": 1,
      "total_with_tax": 1,
      "total_service_price": 29250,
      "exchange_rate": 1,
      "date_created": "2024-12-25 17:38:19",
      "type": "extras",
      "id_fiscal_articles": 1,
      "relationship_id": 43983,
      "advance_remaining_amount": 0,
      "id_reservations_rooms": 0,
      "is_fiscalized": 0,
      "date_fiscalized": null
    }
  ],
  "payment_types": [
    {
      "payment_type": "advance",
      "price": "29250.00",
      "id_invoice_payment_type": 435366,
      "is_advance": 1,
      "id_invoices_advance": 897114,
      "id_reservations_payments": 0,
      "id_reservations": 0,
      "card_type": ""
    }
  ],
  "payment_group_types": [
    {
      "price": 29250,
      "payment_type": "advance"
    }
  ],
  "fiscalized_services": [],
  "advance_invoices": [
    {
      "id_invoices": "894351",
      "mark": "A23-2024",
      "advance_remaining_amount": "14190",
      "price_total": "14190"
    },
    {
      "id_invoices": "907950",
      "mark": "A78-2024",
      "advance_remaining_amount": "4000",
      "price_total": "4000"
    },
    {
      "id_invoices": "907953",
      "mark": "A79-2024",
      "advance_remaining_amount": "4000",
      "price_total": "4000"
    },
    {
      "id_invoices": "916830",
      "mark": "A114-2024",
      "advance_remaining_amount": "3000",
      "price_total": "3000"
    },
    {
      "id_invoices": "921670",
      "mark": "A50-2025",
      "advance_remaining_amount": "29250",
      "price_total": "29250"
    },
    {
      "id_invoices": "922429",
      "mark": "A54-2025",
      "advance_remaining_amount": "90480",
      "price_total": "90480"
    },
    {
      "id_invoices": "923935",
      "mark": "A66-2025",
      "advance_remaining_amount": "41496",
      "price_total": "41496"
    },
    {
      "id_invoic
```

_(response truncated — original length 7.361 characters)_

---

### Insert invoice <a id="insert-invoice"></a>

`POST` `https://app.otasync.me/api/invoices/data/invoice`

**Invoice Data Submission**

This HTTP POST request is used to submit invoice data to the application. It allows users to create or update invoice records with detailed information about orders, services, guests, payments, and other related data.

**Request Body Format**

The request body should be in raw JSON format and include the following parameters:

- **`order_montenegro`**: (integer) An identifier for the order in Montenegro.
- **`services`**: (array of objects) A list of services included in the invoice. Each service object contains:
  - `name`: (string) The name of the service.
  - `quantity`: (integer) The quantity of the service.
  - `price_per_unit`: (number) The price per unit of the service.
  - `discount_amount`: (number) The amount of discount applied.
  - `discount_type`: (string) The type of discount (e.g., percent).
  - `tax`: (string) The tax applicable to the service.
  - `relationship_id`: (integer) An identifier for the relationship.
  - `id_reservations_rooms`: (integer) The ID of the associated reservation room.
  - `id_extras`: (integer) The ID of the extra service.
  - `id_minimax_extras`: (integer) An identifier for minimax extras.
  - `exchange_rate`: (number) The exchange rate applicable.
  - `type`: (string) The type of service ("type", "extras", "boards", "room", "payments", "custom", "citytax", "discount", "conference_rooms", "citytax_adults", "insurance_adults", "citytax_children_1", "citytax_children_2", "insurance_children_1", "citytax_children_3", "insurance_children_2", "spas_bookings", "rooms", "insurance_children_3", "custom_tax", "boards_adults", "boards_children_1", "spa", "boards_children_2", "boards_children_3", "advance", "conference_halls", "citytax_room", "boards_seniors", "citytax_children_4", "citytax_children_5", "citytax_children_6", "boards_children_4", "boards_children_5", "boards_children_6", "citytax_children_7", "boards_children_7", "citytax_percent_room_price", "insurance_children_4", "conference_halls_extras", "transfer_extras", "transfer_room", "transfer_citytax_adults", "transfer_insurance_adults", "transfer_boards_adults", "transfer_citytax_children_2", "transfer_insurance_children_2", "transfer_boards_children_2", "transfer_citytax_children_3", "insurance_children_5", "insurance_children_6", "insurance_children_7", "citytax_seniors", "insurance_seniors", "transfer_insurance_children_1", "transfer_boards_children_1", "room'", "transfer_citytax_children_1", "transfer_insurance_children_3", "transfer_boards_children_3", "transfer_citytax_children_4", "transfer_insurance_children_4", "transfer_boards_children_4").
  - `data_num`: (integer) A numerical identifier for the data.
  - `is_fiscalized`: (integer) Indicates if the service is fiscalized.
- **`id_companies`**: (string) The ID of the company associated with the invoice.
- **`company`**: (integer) The company identifier.
- **`guest_data`**: (object) Information about the guest, containing:
  - `id_guests`: (integer) The ID of the guest.
  - `first_name`: (string) The first name of the guest.
  - `last_name`: (string) The last name of the guest.
  - `address`: (string) The address of the guest.
  - `zip`: (string or null) The postal code.
  - `travel_document_number`: (string) The travel document number.
  - `travel_document_type`: (string or null) The type of travel document.
  - `email`: (string) The email address of the guest.
- **`invoice_exists`**: (boolean) Indicates if the invoice already exists.
- **`guests_note`**: (array) Notes related to guests.
- **`user`**: (object) Information about the user submitting the invoice, containing:
  - `name`: (string) The name of the user.
- **`payments`**: (array of objects) A list of payment methods used, where each payment object contains:
  - `id_reservations_payments`: (integer) The ID of the reservation payment.
  - `id_reservations`: (integer) The ID of the reservation.
  - `method`: (string) The payment method used.
  - `amount`: (number) The amount paid.
  - `payment_date`: (string) The date of the payment.
  - `pay_with_flutter`: (integer) Indicates if payment was made with Flutter.
  - `flutter_id`: (string or null) The Flutter payment ID.
  - `created_advance`: (integer) Indicates if it is an advance payment.
  - `id_reservations_rooms`: (integer) The ID of the reservation room.
  - `pay_with`: (string or null) The payment method used.
  - `quantity`: (integer) The quantity of payments.
- **`additional_exchange_rate`**: (number) Any additional exchange rate applied.
- **`reservation_rooms`**: (array of objects) Information about reservation rooms, including details such as room number, guest status, arrival and departure dates, and pricing.
- **`fiscalized`**: (integer) Indicates if the invoice is fiscalized.
- **`invoice_services`**: (array of objects) A list of services included in the invoice, similar to the `services` parameter.
- **`id_reservations`**: (string) The ID of the reservation.
- **`payment_types`**: (array of objects) Types of payments accepted, including details like payment type and price:
  - `id_reservations`: (integer) The ID of the reservation.
  - **`price`**: (string) The price of the invoice payment type.
  - **`id_invoices_advance`**: (integer) The ID of the invoices advance.
  - **`is_advance`**: (integer) Check if is advance 1, or 0.
  - **`payment_type`**: (string) The type of payment ("cash", "card", "check", "virman", "voucher", "other").
- **`price_total`**: (string) The total price of the invoice.
- **`client_type`**: (integer) The type of client.
- **`id_properties`**: (string) The ID of the properties associated with the invoice.
- **`address`**: (string) The address for the invoice.
- **`date_delivered`**: (string) The date the invoice is delivered.
- **`date_issued`**: (string) The date the invoice is issued.
- **`type`**: (string) The type of the document ("invoice", "advance", "advance_invoice", "storn", "storn_advance", "storned_proforma", "e_faktura", "SUMMARY").
- **`invoice_number`**: (string) The invoice number.
- **`note`**: (string) Any additional notes for the invoice.
- **`country`**: (string) The country of the client.
- **`postal_code`**: (string) The postal code of the client.
- **`city_customer`**: (string) The city of the customer.
- **`advance_remaining_pay_variation_type`**: (string) The variation type for remaining advance payment.
- **`advance_remaining_pay_remaining_amount`**: (number) The remaining amount for advance payment.

**Response Structure**

The response will contain the result of the invoice data addition, typically including a success status, any error messages if applicable, and possibly the ID of the newly created or updated invoice record.

**Request body** (`raw`)

```json
{
  "order_montenegro": 0,
  "id_invoices": "8755",
  "services": [
    {
      "name": "Extras 1",
      "quantity": 1,
      "price_per_unit": 1179,
      "discount_amount": 0,
      "discount_type": "percent",
      "tax": "0",
      "relationship_id": 504311,
      "id_reservations_rooms": 1952059,
      "id_extras": 16,
      "id_minimax_extras": 0,
      "exchange_rate": 1,
      "type": "extras",
      "data_num": 0,
      "is_fiscalized": 0
    },
    {
      "name": "Extras 1",
      "quantity": 1,
      "price_per_unit": 1179,
      "discount_amount": 0,
      "discount_type": "percent",
      "tax": "0",
      "relationship_id": 504312,
      "id_reservations_rooms": 1952060,
      "id_extras": 16,
      "id_minimax_extras": 0,
      "exchange_rate": 1,
      "type": "extras",
      "data_num": 1,
      "is_fiscalized": 0
    },
    {
      "name": "AA (2BDs)",
      "quantity": "3",
      "price_per_unit": 114,
      "discount_amount": 0,
      "discount_type": "percent",
      "tax": 10,
      "relationship_id": 1952058,
      "id_reservations_rooms": 1952058,
      "exchange_rate": 1,
      "type": "room",
      "data_num": 2,
      "is_fiscalized": 0
    },
    {
      "name": "City tax (Adults)",
      "quantity": 150,
      "price_per_unit": 10,
      "discount_amount": 0,
      "discount_type": "fixed",
      "tax": 201,
      "relationship_id": 1,
      "id_reservations_rooms": 1952058,
      "exchange_rate": 1,
      "type": "citytax_adults",
      "data_num": 3,
      "is_fiscalized": 0
    },
    {
      "name": "2A3 (2BDs)",
      "quantity": "3",
      "price_per_unit": 114,
      "discount_amount": 0,
      "discount_type": "percent",
      "tax": 10,
      "relationship_id": 1952059,
      "id_reservations_rooms": 1952059,
      "exchange_rate": 1,
      "type": "room",
      "data_num": 4,
      "is_fiscalized": 0
    },
    {
      "name": "City tax (Adults)",
      "quantity": 150,
      "price_per_unit": 10,
      "discount_amount": 0,
      "discount_type": "fixed",
      "tax": 201,
      "relationship_id": 1,
      "id_reservations_rooms": 1952059,
      "exchange_rate": 1,
      "type": "citytax_adults",
      "data_num": 5,
      "is_fiscalized": 0
    },
    {
      "name": "2 (2BDs)",
      "quantity": "3",
      "price_per_unit": 114,
      "discount_amount": 0,
      "discount_type": "percent",
      "tax": 10,
      "relationship_id": 1952060,
      "id_reservations_rooms": 1952060,
      "exchange_rate": 1,
      "type": "room",
      "data_num": 6,
      "is_fiscalized": 0
    },
    {
      "name": "City tax (Adults)",
      "quantity": 150,
      "price_per_unit": 10,
      "discount_amount": 0,
      "discount_type": "fixed",
      "tax": 201,
      "relationship_id": 1,
      "id_reservations_rooms": 1952060,
      "exchange_rate": 1,
      "type": "citytax_adults",
      "data_num": 7,
      "is_fiscalized": 0
    }
  ],
  "id_companies": "0",
  "company": 0,
  "guest_data": {
    "id_guests": 3408143,
    "first_name": "Viktor",
    "last_name": "Test",
    "address": "",
    "zip": null,
    "travel_document_number": "",
    "travel_document_type": null,
    "email": ""
  },
  "invoice_exists": false,
  "guests_note": [],
  "user": {
    "name": " Pedja Avramovicddqr"
  },
  "payments": [
    {
      "id_reservations_payments": 65987,
      "id_reservations": 1334313,
      "method": "virman",
      "amount": 19,
      "payment_date": "2023-11-27",
      "pay_with_flutter": 0,
      "flutter_id": null,
      "created_advance": 0,
      "id_reservations_rooms": 1952059,
      "pay_with": null,
      "quantity": 1
    }
  ],
  "payments_advance": [],
  "additional_exchange_rate": 1,
  "reservation_rooms": [
    {
      "id_rooms": 323,
      "room_number": "AA",
      "id_reservations_rooms": 1952058,
      "id_room_types": 170,
      "name": "2-Bedroom Apartment with Sea View",
      "shortname": "2BDs",
      "children_1": 0,
      "children_2": 0,
      "children_3": 0,
      "children_4": 0,
      "children_5": 0,
      "children_6": 0,
      "children_7": 0,
      "adults": 50,
      "seniors": 0,
      "total_guests": 50,
      "avg_price": 95,
      "total_price": 285,
      "first_meal": "breakfast",
      "occupancy": 50,
      "guest_status": "waiting_arrival",
      "status": "confirmed",
      "canceled_reason": null,
      "date_arrival": "2023-11-27",
      "date_departure": "2023-11-30",
      "nights_count": 3,
      "room_discount": 0,
      "extras_discount": 0,
      "board_discount": 0,
      "discount_type": "percent",
      "discount_amount": 0,
      "discounted_price": 285,
      "note": "",
      "board_total": 0,
      "city_tax_total": 1500,
      "insurance_total": 0,
      "board_discounted": 0,
      "extras_total": 0,
      "extras_discounted": 0,
      "parking_count": 0,
      "parking_note": "",
      "extra_bed": 0,
      "extra_baby_bed": 0,
      "flight_time_arrival": "",
      "flight_number": "0",
      "locked": 0,
      "free_of_charge": 0,
      "overbooking": 0,
      "original_id_room_types": 170,
      "original_room_type_prices": 0,
      "channex_index": -1,
      "room_guest_check_in": null,
      "room_guest_check_out": null,
      "apply_discount_to": [],
      "nights": [
        {
          "id_reservations_nights": 10859652,
          "id_reservations": 1334313,
          "id_reservations_rooms": 1952058,
          "night_date": "2023-11-27",
          "breakfast": 50,
          "lunch": 50,
          "dinner": 50,
          "price": 95,
          "original_price": 95,
          "id_properties": 93,
          "id_pricing_plans": 370,
          "id_boards": 835,
          "board_price_per_day": 0,
          "board_price_per_day_discounted": 0,
          "breakfast_children_1": 0,
          "breakfast_children_2": 0,
          "breakfast_children_3": 0,
          "breakfast_children_4": 0,
          "breakfast_children_5": 0,
          "breakfast_children_6": 0,
          "breakfast_children_7": 0,
          "breakfast_adults": 50,
          "breakfast_seniors": 0,
          "lunch_children_1": 0,
          "lunch_children_2": 0,
          "lunch_children_3": 0,
          "lunch_children_4": 0,
          "lunch_children_5": 0,
          "lunch_children_6": 0,
          "lunch_children_7": 0,
          "lunch_adults": 50,
          "lunch_seniors": 0,
          "dinner_children_1": 0,
          "dinner_children_2": 0,
          "dinner_children_3": 0,
          "dinner_children_4": 0,
          "dinner_children_5": 0,
          "dinner_children_6": 0,
          "dinner_children_7": 0,
          "dinner_adults": 50,
          "dinner_seniors": 0,
          "board_price_per_day_children_1": 0,
          "board_price_per_day_children_2": 0,
          "board_price_per_day_children_3": 0,
          "board_price_per_day_children_4": 0,
          "board_price_per_day_children_5": 0,
          "board_price_per_day_children_6": 0,
          "board_price_per_day_children_7": 0,
          "board_price_per_day_adults": 0,
          "board_price_per_day_seniors": 0,
          "board_price_per_day_children_1_discounted": 0,
          "board_price_per_day_children_2_discounted": 0,
          "board_price_per_day_children_3_discounted": 0,
          "board_price_per_day_children_4_discounted": 0,
          "board_price_per_day_children_5_discounted": 0,
          "board_price_per_day_children_6_discounted": 0,
          "board_price_per_day_children_7_discounted": 0,
          "board_price_per_day_adults_discounted": 0,
          "board_price_per_day_seniors_discounted": 0
        },
        {
          "id_reservations_nights": 10859653,
          "id_reservations": 1334313,
          "id_reservations_rooms": 1952058,
          "night_date": "2023-11-28",
          "breakfast": 50,
          "lunch": 50,
          "dinner": 50,
          "price": 95,
          "original_price": 95,
          "id_properties": 93,
          "id_pricing_plans": 370,
          "id_boards": 835,
          "board_price_per_day": 0,
          "board_price_per_day_discounted": 0,
          "breakfast_children_1": 0,
          "breakfast_children_2": 0,
          "breakfast_children_3": 0,
          "breakfast_children_4": 0,
          "breakfast_children_5": 0,
          "breakfast_children_6": 0,
          "breakfast_children_7": 0,
          "breakfast_adults": 50,
          "breakfast_seniors": 0,
          "lunch_children_1": 0,
          "lunch_children_2": 0,
          "lunch_children_3": 0,
          "lunch_children_4": 0,
          "lunch_children_5": 0,
          "lunch_children_6": 0,
          "lunch_children_7": 0,
          "lunch_adults": 50,
          "lunch_seniors": 0,
          "dinner_children_1": 0,
          "dinner_children_2": 0,
          "dinner_children_3": 0,
          "dinner_children_4": 0,
          "dinner_children_5": 0,
          "dinner_children_6": 0,
          "dinner_children_7": 0,
          "dinner_adults": 50,
          "dinner_seniors": 0,
          "board_price_per_day_children_1": 0,
          "board_price_per_day_children_2": 0,
          "board_price_per_day_children_3": 0,
          "board_price_per_day_children_4": 0,
          "board_price_per_day_children_5": 0,
          "board_price_per_day_children_6": 0,
          "board_price_per_day_children_7": 0,
          "board_price_per_day_adults": 0,
          "board_price_per_day_seniors": 0,
          "board_price_per_day_children_1_discounted": 0,
          "board_price_per_day_children_2_discounted": 0,
          "board_price_per_day_children_3_discounted": 0,
          "board_price_per_day_children_4_discounted": 0,
          "board_price_per_day_children_5_discounted": 0,
          "board_price_per_day_children_6_discounted": 0,
          "board_price_per_day_children_7_discounted": 0,
          "board_price_per_day_adults_discounted": 0,
          "board_price_per_day_seniors_discounted": 0
        },
        {
          "id_reservations_nights": 10859654,
          "id_reservations": 1334313,
          "id_reservations_rooms": 1952058,
          "night_date": "2023-11-29",
          "breakfast": 50,
          "lunch": 50,
          "dinner": 50,
          "price": 95,
          "original_price": 95,
          "id_properties": 93,
          "id_pricing_plans": 370,
          "id_boards": 835,
          "board_price_per_day": 0,
          "board_price_per_day_discounted": 0,
          "breakfast_children_1": 0,
          "breakfast_children_2": 0,
          "breakfast_children_3": 0,
          "breakfast_children_4": 0,
          "breakfast_children_5": 0,
          "breakfast_children_6": 0,
          "breakfast_children_7": 0,
          "breakfast_adults": 50,
          "breakfast_seniors": 0,
          "lunch_children_1": 0,
          "lunch_children_2": 0,
          "lunch_children_3": 0,
          "lunch_children_4": 0,
          "lunch_children_5": 0,
          "lunch_children_6": 0,
          "lunch_children_7": 0,
          "lunch_adults": 50,
          "lunch_seniors": 0,
          "dinner_children_1": 0,
          "dinner_children_2": 0,
          "dinner_children_3": 0,
          "dinner_children_4": 0,
          "dinner_children_5": 0,
          "dinner_children_6": 0,
          "dinner_children_7": 0,
          "dinner_adults": 50,
          "dinner_seniors": 0,
          "board_price_per_day_children_1": 0,
          "board_price_per_day_children_2": 0,
          "board_price_per_day_children_3": 0,
          "board_price_per_day_children_4": 0,
          "board_price_per_day_children_5": 0,
          "board_price_per_day_children_6": 0,
          "board_price_per_day_children_7": 0,
          "board_price_per_day_adults": 0,
          "board_price_per_day_seniors": 0,
          "board_price_per_day_children_1_discounted": 0,
          "board_price_per_day_children_2_discounted": 0,
          "board_price_per_day_children_3_discounted": 0,
          "board_price_per_day_children_4_discounted": 0,
          "board_price_per_day_children_5_discounted": 0,
          "board_price_per_day_children_6_discounted": 0,
          "board_price_per_day_children_7_discounted": 0,
          "board_price_per_day_adults_discounted": 0,
          "board_price_per_day_seniors_discounted": 0
        }
      ]
    },
    {
      "id_rooms": 324,
      "room_number": "2A3",
      "id_reservations_rooms": 1952059,
      "id_room_types": 170,
      "name": "2-Bedroom Apartment with Sea View",
      "shortname": "2BDs",
      "children_1": 0,
      "children_2": 0,
      "children_3": 0,
      "children_4": 0,
      "children_5": 0,
      "children_6": 0,
      "children_7": 0,
      "adults": 50,
      "seniors": 0,
      "total_guests": 50,
      "avg_price": 95,
      "total_price": 285,
      "first_meal": "breakfast",
      "occupancy": 50,
      "guest_status": "waiting_arrival_advance",
      "status": "confirmed",
      "canceled_reason": null,
      "date_arrival": "2023-11-27",
      "date_departure": "2023-11-30",
      "nights_count": 3,
      "room_discount": 0,
      "extras_discount": 0,
      "board_discount": 0,
      "discount_type": "percent",
      "discount_amount": 0,
      "discounted_price": 285,
      "note": "",
      "board_total": 0,
      "city_tax_total": 1500,
      "insurance_total": 0,
      "board_discounted": 0,
      "extras_total": 1179,
      "extras_discounted": 1179,
      "parking_count": 0,
      "parking_note": "",
      "extra_bed": 0,
      "extra_baby_bed": 0,
      "flight_time_arrival": "",
      "flight_number": "0",
      "locked": 0,
      "free_of_charge": 0,
      "overbooking": 0,
      "original_id_room_types": 170,
      "original_room_type_prices": 0,
      "channex_index": -1,
      "room_guest_check_in": null,
      "room_guest_check_out": null,
      "apply_discount_to": [],
      "nights": [
        {
          "id_reservations_nights": 10859655,
          "id_reservations": 1334313,
          "id_reservations_rooms": 1952059,
          "night_date": "2023-11-27",
          "breakfast": 50,
          "lunch": 50,
          "dinner": 50,
          "price": 95,
          "original_price": 95,
          "id_properties": 93,
          "id_pricing_plans": 370,
          "id_boards": 835,
          "board_price_per_day": 0,
          "board_price_per_day_discounted": 0,
          "breakfast_children_1": 0,
          "breakfast_children_2": 0,
          "breakfast_children_3": 0,
          "breakfast_children_4": 0,
          "breakfast_children_5": 0,
          "breakfast_children_6": 0,
          "breakfast_children_7": 0,
          "breakfast_adults": 50,
          "breakfast_seniors": 0,
          "lunch_children_1": 0,
          "lunch_children_2": 0,
          "lunch_children_3": 0,
          "lunch_children_4": 0,
          "lunch_children_5": 0,
          "lunch_children_6": 0,
          "lunch_children_7": 0,
          "lunch_adults": 50,
          "lunch_seniors": 0,
          "dinner_children_1": 0,
          "dinner_children_2": 0,
          "dinner_children_3": 0,
          "dinner_children_4": 0,
          "dinner_children_5": 0,
          "dinner_children_6": 0,
          "dinner_children_7": 0,
          "dinner_adults": 50,
          "dinner_seniors": 0,
          "board_price_per_day_children_1": 0,
          "board_price_per_day_children_2": 0,
          "board_price_per_day_children_3": 0,
          "board_price_per_day_children_4": 0,
          "board_price_per_day_children_5": 0,
          "board_price_per_day_children_6": 0,
          "board_price_per_day_children_7": 0,
          "board_price_per_day_adults": 0,
          "board_price_per_day_seniors": 0,
          "board_price_per_day_children_1_discounted": 0,
          "board_price_per_day_children_2_discounted": 0,
          "board_price_per_day_children_3_discounted": 0,
          "board_price_per_day_children_4_discounted": 0,
          "board_price_per_day_children_5_discounted": 0,
          "board_price_per_day_children_6_discounted": 0,
          "board_price_per_day_children_7_discounted": 0,
          "board_price_per_day_adults_discounted": 0,
          "board_price_per_day_seniors_discounted": 0
        },
        {
          "id_reservations_nights": 10859656,
          "id_reservations": 1334313,
          "id_reservations_rooms": 1952059,
          "night_date": "2023-11-28",
          "breakfast": 50,
          "lunch": 50,
          "dinner": 50,
          "price": 95,
          "original_price": 95,
          "id_properties": 93,
          "id_pricing_plans": 370,
          "id_boards": 835,
          "board_price_per_day": 0,
          "board_price_per_day_discounted": 0,
          "breakfast_children_1": 0,
          "breakfast_children_2": 0,
          "breakfast_children_3": 0,
          "breakfast_children_4": 0,
          "breakfast_children_5": 0,
          "breakfast_children_6": 0,
          "breakfast_children_7": 0,
          "breakfast_adults": 50,
          "breakfast_seniors": 0,
          "lunch_children_1": 0,
          "lunch_children_2": 0,
          "lunch_children_3": 0,
          "lunch_children_4": 0,
          "lunch_children_5": 0,
          "lunch_children_6": 0,
          "lunch_children_7": 0,
          "lunch_adults": 50,
          "lunch_seniors": 0,
          "dinner_children_1": 0,
          "dinner_children_2": 0,
          "dinner_children_3": 0,
          "dinner_children_4": 0,
          "dinner_children_5": 0,
          "dinner_children_6": 0,
          "dinner_children_7": 0,
          "dinner_adults": 50,
          "dinner_seniors": 0,
          "board_price_per_day_children_1": 0,
          "board_price_per_day_children_2": 0,
          "board_price_per_day_children_3": 0,
          "board_price_per_day_children_4": 0,
          "board_price_per_day_children_5": 0,
          "board_price_per_day_children_6": 0,
          "board_price_per_day_children_7": 0,
          "board_price_per_day_adults": 0,
          "board_price_per_day_seniors": 0,
          "board_price_per_day_children_1_discounted": 0,
          "board_price_per_day_children_2_discounted": 0,
          "board_price_per_day_children_3_discounted": 0,
          "board_price_per_day_children_4_discounted": 0,
          "board_price_per_day_children_5_discounted": 0,
          "board_price_per_day_children_6_discounted": 0,
          "board_price_per_day_children_7_discounted": 0,
          "board_price_per_day_adults_discounted": 0,
          "board_price_per_day_seniors_discounted": 0
        },
        {
          "id_reservations_nights": 10859657,
          "id_reservations": 1334313,
          "id_reservations_rooms": 1952059,
          "night_date": "2023-11-29",
          "breakfast": 50,
          "lunch": 50,
          "dinner": 50,
          "price": 95,
          "original_price": 95,
          "id_properties": 93,
          "id_pricing_plans": 370,
          "id_boards": 835,
          "board_price_per_day": 0,
          "board_price_per_day_discounted": 0,
          "breakfast_children_1": 0,
          "breakfast_children_2": 0,
          "breakfast_children_3": 0,
          "breakfast_children_4": 0,
          "breakfast_children_5": 0,
          "breakfast_children_6": 0,
          "breakfast_children_7": 0,
          "breakfast_adults": 50,
          "breakfast_seniors": 0,
          "lunch_children_1": 0,
          "lunch_children_2": 0,
          "lunch_children_3": 0,
          "lunch_children_4": 0,
          "lunch_children_5": 0,
          "lunch_children_6": 0,
          "lunch_children_7": 0,
          "lunch_adults": 50,
          "lunch_seniors": 0,
          "dinner_children_1": 0,
          "dinner_children_2": 0,
          "dinner_children_3": 0,
          "dinner_children_4": 0,
          "dinner_children_5": 0,
          "dinner_children_6": 0,
          "dinner_children_7": 0,
          "dinner_adults": 50,
          "dinner_seniors": 0,
          "board_price_per_day_children_1": 0,
          "board_price_per_day_children_2": 0,
          "board_price_per_day_children_3": 0,
          "board_price_per_day_children_4": 0,
          "board_price_per_day_children_5": 0,
          "board_price_per_day_children_6": 0,
          "board_price_per_day_children_7": 0,
          "board_price_per_day_adults": 0,
          "board_price_per_day_seniors": 0,
          "board_price_per_day_children_1_discounted": 0,
          "board_price_per_day_children_2_discounted": 0,
          "board_price_per_day_children_3_discounted": 0,
          "board_price_per_day_children_4_discounted": 0,
          "board_price_per_day_children_5_discounted": 0,
          "board_price_per_day_children_6_discounted": 0,
          "board_price_per_day_children_7_discounted": 0,
          "board_price_per_day_adults_discounted": 0,
          "board_price_per_day_seniors_discounted": 0
        }
      ]
    },
    {
      "id_rooms": 2971,
      "room_number": "2",
      "id_reservations_rooms": 1952060,
      "id_room_types": 170,
      "name": "2-Bedroom Apartment with Sea View",
      "shortname": "2BDs",
      "children_1": 0,
      "children_2": 0,
      "children_3": 0,
      "children_4": 0,
      "children_5": 0,
      "children_6": 0,
      "children_7": 0,
      "adults": 50,
      "seniors": 0,
      "total_guests": 50,
      "avg_price": 95,
      "total_price": 285,
      "first_meal": "breakfast",
      "occupancy": 50,
      "guest_status": "waiting_arrival",
      "status": "confirmed",
      "canceled_reason": null,
      "date_arrival": "2023-11-27",
      "date_departure": "2023-11-30",
      "nights_count": 3,
      "room_discount": 0,
      "extras_discount": 0,
      "board_discount": 0,
      "discount_type": "percent",
      "discount_amount": 0,
      "discounted_price": 285,
      "note": "",
      "board_total": 0,
      "city_tax_total": 1500,
      "insurance_total": 0,
      "board_discounted": 0,
      "extras_total": 1179,
      "extras_discounted": 1179,
      "parking_count": 0,
      "parking_note": "",
      "extra_bed": 0,
      "extra_baby_bed": 0,
      "flight_time_arrival": "",
      "flight_number": "0",
      "locked": 0,
      "free_of_charge": 0,
      "overbooking": 0,
      "original_id_room_types": 170,
      "original_room_type_prices": 0,
      "channex_index": -1,
      "room_guest_check_in": null,
      "room_guest_check_out": null,
      "apply_discount_to": [],
      "nights": [
        {
          "id_reservations_nights": 10859658,
          "id_reservations": 1334313,
          "id_reservations_rooms": 1952060,
          "night_date": "2023-11-27",
          "breakfast": 50,
          "lunch": 50,
          "dinner": 50,
          "price": 95,
          "original_price": 95,
          "id_properties": 93,
          "id_pricing_plans": 370,
          "id_boards": 835,
          "board_price_per_day": 0,
          "board_price_per_day_discounted": 0,
          "breakfast_children_1": 0,
          "breakfast_children_2": 0,
          "breakfast_children_3": 0,
          "breakfast_children_4": 0,
          "breakfast_children_5": 0,
          "breakfast_children_6": 0,
          "breakfast_children_7": 0,
          "breakfast_adults": 50,
          "breakfast_seniors": 0,
          "lunch_children_1": 0,
          "lunch_children_2": 0,
          "lunch_children_3": 0,
          "lunch_children_4": 0,
          "lunch_children_5": 0,
          "lunch_children_6": 0,
          "lunch_children_7": 0,
          "lunch_adults": 50,
          "lunch_seniors": 0,
          "dinner_children_1": 0,
          "dinner_children_2": 0,
          "dinner_children_3": 0,
          "dinner_children_4": 0,
          "dinner_children_5": 0,
          "dinner_children_6": 0,
          "dinner_children_7": 0,
          "dinner_adults": 50,
          "dinner_seniors": 0,
          "board_price_per_day_children_1": 0,
          "board_price_per_day_children_2": 0,
          "board_price_per_day_children_3": 0,
          "board_price_per_day_children_4": 0,
          "board_price_per_day_children_5": 0,
          "board_price_per_day_children_6": 0,
          "board_price_per_day_children_7": 0,
          "board_price_per_day_adults": 0,
          "board_price_per_day_seniors": 0,
          "board_price_per_day_children_1_discounted": 0,
          "board_price_per_day_children_2_discounted": 0,
          "board_price_per_day_children_3_discounted": 0,
          "board_price_per_day_children_4_discounted": 0,
          "board_price_per_day_children_5_discounted": 0,
          "board_price_per_day_children_6_discounted": 0,
          "board_price_per_day_children_7_discounted": 0,
          "board_price_per_day_adults_discounted": 0,
          "board_price_per_day_seniors_discounted": 0
        },
        {
          "id_reservations_nights": 10859659,
          "id_reservations": 1334313,
          "id_reservations_rooms": 1952060,
          "night_date": "2023-11-28",
          "breakfast": 50,
          "lunch": 50,
          "dinner": 50,
          "price": 95,
          "original_price": 95,
          "id_properties": 93,
          "id_pricing_plans": 370,
          "id_boards": 835,
          "board_price_per_day": 0,
          "board_price_per_day_discounted": 0,
          "breakfast_children_1": 0,
          "breakfast_children_2": 0,
          "breakfast_children_3": 0,
          "breakfast_children_4": 0,
          "breakfast_children_5": 0,
          "breakfast_children_6": 0,
          "breakfast_children_7": 0,
          "breakfast_adults": 50,
          "breakfast_seniors": 0,
          "lunch_children_1": 0,
          "lunch_children_2": 0,
          "lunch_children_3": 0,
          "lunch_children_4": 0,
          "lunch_children_5": 0,
          "lunch_children_6": 0,
          "lunch_children_7": 0,
          "lunch_adults": 50,
          "lunch_seniors": 0,
          "dinner_children_1": 0,
          "dinner_children_2": 0,
          "dinner_children_3": 0,
          "dinner_children_4": 0,
          "dinner_children_5": 0,
          "dinner_children_6": 0,
          "dinner_children_7": 0,
          "dinner_adults": 50,
          "dinner_seniors": 0,
          "board_price_per_day_children_1": 0,
          "board_price_per_day_children_2": 0,
          "board_price_per_day_children_3": 0,
          "board_price_per_day_children_4": 0,
          "board_price_per_day_children_5": 0,
          "board_price_per_day_children_6": 0,
          "board_price_per_day_children_7": 0,
          "board_price_per_day_adults": 0,
          "board_price_per_day_seniors": 0,
          "board_price_per_day_children_1_discounted": 0,
          "board_price_per_day_children_2_discounted": 0,
          "board_price_per_day_children_3_discounted": 0,
          "board_price_per_day_children_4_discounted": 0,
          "board_price_per_day_children_5_discounted": 0,
          "board_price_per_day_children_6_discounted": 0,
          "board_price_per_day_children_7_discounted": 0,
          "board_price_per_day_adults_discounted": 0,
          "board_price_per_day_seniors_discounted": 0
        },
        {
          "id_reservations_nights": 10859660,
          "id_reservations": 1334313,
          "id_reservations_rooms": 1952060,
          "night_date": "2023-11-29",
          "breakfast": 50,
          "lunch": 50,
          "dinner": 50,
          "price": 95,
          "original_price": 95,
          "id_properties": 93,
          "id_pricing_plans": 370,
          "id_boards": 835,
          "board_price_per_day": 0,
          "board_price_per_day_discounted": 0,
          "breakfast_children_1": 0,
          "breakfast_children_2": 0,
          "breakfast_children_3": 0,
          "breakfast_children_4": 0,
          "breakfast_children_5": 0,
          "breakfast_children_6": 0,
          "breakfast_children_7": 0,
          "breakfast_adults": 50,
          "breakfast_seniors": 0,
          "lunch_children_1": 0,
          "lunch_children_2": 0,
          "lunch_children_3": 0,
          "lunch_children_4": 0,
          "lunch_children_5": 0,
          "lunch_children_6": 0,
          "lunch_children_7": 0,
          "lunch_adults": 50,
          "lunch_seniors": 0,
          "dinner_children_1": 0,
          "dinner_children_2": 0,
          "dinner_children_3": 0,
          "dinner_children_4": 0,
          "dinner_children_5": 0,
          "dinner_children_6": 0,
          "dinner_children_7": 0,
          "dinner_adults": 50,
          "dinner_seniors": 0,
          "board_price_per_day_children_1": 0,
          "board_price_per_day_children_2": 0,
          "board_price_per_day_children_3": 0,
          "board_price_per_day_children_4": 0,
          "board_price_per_day_children_5": 0,
          "board_price_per_day_children_6": 0,
          "board_price_per_day_children_7": 0,
          "board_price_per_day_adults": 0,
          "board_price_per_day_seniors": 0,
          "board_price_per_day_children_1_discounted": 0,
          "board_price_per_day_children_2_discounted": 0,
          "board_price_per_day_children_3_discounted": 0,
          "board_price_per_day_children_4_discounted": 0,
          "board_price_per_day_children_5_discounted": 0,
          "board_price_per_day_children_6_discounted": 0,
          "board_price_per_day_children_7_discounted": 0,
          "board_price_per_day_adults_discounted": 0,
          "board_price_per_day_seniors_discounted": 0
        }
      ]
    }
  ],
  "fiscalized": 0,
  "invoice_services": [
    {
      "name": "Extras 1",
      "quantity": 1,
      "price_per_unit": 1179,
      "discount_amount": 0,
      "discount_type": "percent",
      "tax": "0",
      "relationship_id": 504311,
      "id_reservations_rooms": 1952059,
      "id_extras": 16,
      "id_minimax_extras": 0,
      "exchange_rate": 1,
      "type": "extras",
      "data_num": 0,
      "is_fiscalized": 0
    },
    {
      "name": "Extras 1",
      "quantity": 1,
      "price_per_unit": 1179,
      "discount_amount": 0,
      "discount_type": "percent",
      "tax": "0",
      "relationship_id": 504312,
      "id_reservations_rooms": 1952060,
      "id_extras": 16,
      "id_minimax_extras": 0,
      "exchange_rate": 1,
      "type": "extras",
      "data_num": 1,
      "is_fiscalized": 0
    },
    {
      "name": "AA (2BDs)",
      "quantity": "3",
      "price_per_unit": 114,
      "discount_amount": 0,
      "discount_type": "percent",
      "tax": 10,
      "relationship_id": 1952058,
      "id_reservations_rooms": 1952058,
      "exchange_rate": 1,
      "type": "room",
      "data_num": 2,
      "is_fiscalized": 0
    },
    {
      "name": "City tax (Adults)",
      "quantity": 150,
      "price_per_unit": 10,
      "discount_amount": 0,
      "discount_type": "fixed",
      "tax": 201,
      "relationship_id": 1,
      "id_reservations_rooms": 1952058,
      "exchange_rate": 1,
      "type": "citytax_adults",
      "data_num": 3,
      "is_fiscalized": 0
    },
    {
      "name": "2A3 (2BDs)",
      "quantity": "3",
      "price_per_unit": 114,
      "discount_amount": 0,
      "discount_type": "percent",
      "tax": 10,
      "relationship_id": 1952059,
      "id_reservations_rooms": 1952059,
      "exchange_rate": 1,
      "type": "room",
      "data_num": 4,
      "is_fiscalized": 0
    },
    {
      "name": "City tax (Adults)",
      "quantity": 150,
      "price_per_unit": 10,
      "discount_amount": 0,
      "discount_type": "fixed",
      "tax": 201,
      "relationship_id": 1,
      "id_reservations_rooms": 1952059,
      "exchange_rate": 1,
      "type": "citytax_adults",
      "data_num": 5,
      "is_fiscalized": 0
    },
    {
      "name": "2 (2BDs)",
      "quantity": "3",
      "price_per_unit": 114,
      "discount_amount": 0,
      "discount_type": "percent",
      "tax": 10,
      "relationship_id": 1952060,
      "id_reservations_rooms": 1952060,
      "exchange_rate": 1,
      "type": "room",
      "data_num": 6,
      "is_fiscalized": 0
    },
    {
      "name": "City tax (Adults)",
      "quantity": 150,
      "price_per_unit": 10,
      "discount_amount": 0,
      "discount_type": "fixed",
      "tax": 201,
      "relationship_id": 1,
      "id_reservations_rooms": 1952060,
      "exchange_rate": 1,
      "type": "citytax_adults",
      "data_num": 7,
      "is_fiscalized": 0
    }
  ],
  "id_reservations": "1334313",
  "payment_types": [
    {
      "payment_type": "virman",
      "price": "19.00",
      "id_invoices_advance": 0,
      "id_reservations": 0,
      "is_advance": 0
    },
    {
      "payment_type": "cash",
      "price": "7865.00",
      "id_invoices_advance": 0,
      "id_reservations": 0,
      "is_advance": 0
    }
  ],
  "price_total": "7884.00",
  "client_type": 1,
  "id_properties": "93",
  "id_conference_halls_bookings": "0",
  "id_spas_bookings": "0",
  "address": "Adresa",
  "date_delivered": "2025-03-12",
  "date_issued": "2025-03-12",
  "date_turnover": "2020-11-11",
  "type": "invoice",
  "invoice_number": "",
  "name": "Kompanija1",
  "id_guests": "3408143",
  "pib": "111",
  "mb": "REG",
  "note": "",
  "country": "RS",
  "postal_code": "",
  "city_customer": "",
  "invoice_variation_type": "0",
  "invoice_variation_amount": "0",
  "show_separate_check_number": 1,
  "turnover_of_goods": "2025-03-12",
  "paid": 0,
  "reservation_holder": "Viktor Test",
  "allow_custom_articles_in_invoice": 1,
  "city_tax_invoice_greece": "0",
  "advance_remaining_pay_variation_type": "percent",
  "advance_remaining_pay_variation_amount": "100",
  "advance_remaining_pay_remaining_amount": 7884,
  "key": "0401e2384db9848fbb8b14a5aa3e761d8a910ed6",
  "mark": ""
}
```

**Example response — Insert invoice** `200 OK`

```json
{
  "id_invoices": 8755,
  "id_properties": 93,
  "id_reservations": 84298,
  "id_conference_halls_bookings": null,
  "id_spas_bookings": null,
  "id_guests": 97199,
  "link_invoice": null,
  "advance_link_invoice": null,
  "mark": "36-2021",
  "invoice_number": 36,
  "invoice_year": 2021,
  "date_issued": "2021-11-16",
  "date_delivered": "2021-11-16",
  "date_turnover": "2020-11-11",
  "payment_method": "cash",
  "paid": 1,
  "type": "advance_invoice",
  "name": "Company",
  "pib": "123456789",
  "mb": "321654876",
  "travel_document_number": "1",
  "address": "Address 14",
  "country": "Croatia",
  "city": "Kotor",
  "postal_code": null,
  "email": "1",
  "phone": "1",
  "note": "",
  "price_paid": 0,
  "price_to_pay": 25258.896,
  "price_total": 25258.896,
  "split": 0,
  "splitted_by": null,
  "advance_remaining_amount": 0,
  "advance_amount": 0,
  "reservation_holder": null,
  "downloaded_fiscal": 0,
  "fiscalized": 0,
  "fiscalized_date": null,
  "fiscalized_user": 0,
  "id_users": " ",
  "client_type": "1",
  "turnover_of_goods": "2021-11-16",
  "id_companies": "74",
  "is_merged": 0,
  "reservations_modified": 0,
  "id_reservations_old": 0,
  "advance_remaining_pay_variation_type": null,
  "advance_remaining_pay_variation_amount": null,
  "advance_remaining_pay_amount": null,
  "is_storned": 0,
  "auto_storned": 0,
  "city_tax_invoice_greece": 0,
  "split_stay_invoice": 0,
  "date_departure_invoice": null,
  "invoice_type_hr": 0,
  "split_by_guest": 0,
  "id_users_created": 0,
  "is_dummy": 0,
  "is_deleted": 0,
  "date_deleted": null,
  "is_modified": 0,
  "date_modified": null,
  "date_created": "2021-11-16 12:19:23",
  "city_customer": null,
  "first_name": "Vitkir",
  "last_name": "CIRIC",
  "guest_email": "viktorciric31@gmail.com",
  "properties_pib": "03005585",
  "properties_mb": null,
  "properties_bank_account": null,
  "properties_bank_account_2": null,
  "properties_address": "New address",
  "properties_swift": null,
  "properties_iban": null,
  "properties_phone": "0649124038",
  "properties_company_name": "Test",
  "invoice_logo": "",
  "engine_logo": "https://app.otasync.me/images/property_logo_93.png?v=1705405600",
  "vat_system": 0,
  "reference": null,
  "customer_country": "11",
  "set_invoice_as_paid_after_fiscal": 0,
  "invoice_property_city": null,
  "invoice_property_country": null,
  "invoice_property_address": null,
  "company_email": null,
  "reservation_data": {
    "date_arrival": "2021-11-22",
    "date_departure": "2021-11-24",
    "id_reservations": 84298,
    "channel_name": "Booking engine",
    "channel_type": "Booking engine"
  },
  "reservation_rooms": [
    {
      "id_rooms": 3005,
      "room_number": "36",
      "id_reservations_rooms": 151157,
      "id_room_types": 171,
      "name": "Luxury 2-Bedroom Apartment",
      "shortname": "2BLX",
      "children_1": 0,
      "children_2": 0,
      "children_3": 0,
      "children_4": 0,
      "children_5": 0,
      "children_6": 0,
      "children_7": 0,
      "adults": 1,
      "seniors": 0,
      "total_guests": 1,
      "avg_price": 105,
      "total_price": 210,
      "first_meal": "none",
      "occupancy": 5
    }
  ],
  "storn_invoice_number_bih": null,
  "invoice_services": [],
  "payment_types": [
    {
      "payment_type": "card",
      "price": "200.00",
      "id_invoice_payment_type": 577,
      "is_advance": 0,
      "id_invoices_advance": 0,
      "id_reservations_payments": 0,
      "id_reservations": null,
      "card_type": null
    },
    {
      "payment_type": "card",
      "price": "100.00",
      "id_invoice_payment_type": 578,
      "is_advance": 0,
      "id_invoices_advance": 0,
      "id_reservations_payments": 0,
      "id_reservations": null,
      "card_type": null
    },
    {
      "payment_type": "check",
      "price": "600.00",
      "id_invoice_payment_type": 579,
      "is_advance": 0,
      "id_invoices_advance": 0,
      "id_reservations_payments": 0,
      "id_reservations": null,
      "card_type": null
    },
    {
      "payment_type": "virman",
      "price": "800.00",
      "id_invoice_payment_type": 580,
      "is_advance": 0,
      "id_invoices_advance": 0,
      "id_reservations_payments": 0,
      "id_reservations": null,
      "card_type": null
    },
    {
      "payment_type": "other",
      "price": "23558.90",
      "id_invoice_payment_type": 581,
      "is_advance": 0,
      "id_invoices_advance": 0,
      "id_reservations_payments": 0,
      "id_reservations": null,
      "card_type": null
    }
  ],
  "payment_group_types": [
    {
      "price": 300,
      "payment_type": "card"
    },
    {
      "price": 600,
      "payment_type": "check"
    },
    {
      "price": 800,
      "payment_type": "virman"
    },
    {
      "price": 23558.9,
      "payment_type": "other"
    }
  ],
  "fiscalized_services": [],
  "advance_invoices": [],
  "guest_status": "waiting_arrival",
  "reservation_advances": [],
  "grouped_services": [],
  "sent_emails": [],
  "additional_exchange_rate": "1"
}
```

---

### Get invoices <a id="get-invoices"></a>

`POST` `https://app.otasync.me/api/invoices/data/invoices`

**API Endpoint: Retrieve Invoices Data**

This endpoint allows users to retrieve invoices data based on specific criteria. It accepts various parameters to filter and paginate the results, enabling efficient data retrieval.

**Request**

- **Method**: POST
- **URL**: `https://app.otasync.me/api/invoices/data/invoices`
- **Content-Type**: application/json

**Request Body**

The request body must be in JSON format and includes the following parameters:

- `id_properties` (string): The identifier for the property associated with the invoices.
- `token` (string): A unique token for authentication.
- `key` (string): A unique key for additional verification.
- `companies` (string): The company identifier (use "0" for all companies).
- `dfrom` (string): The start date for filtering invoices (format: YYYY-MM-DD).
- `dfrom_delivered` (string): The start date for filtering delivered invoices (optional).
- `dto` (string): The end date for filtering invoices (format: YYYY-MM-DD).
- `dto_delivered` (string): The end date for filtering delivered invoices (optional).
- `page` (integer): The page number for pagination.
- `search` (string): A search term to filter invoices (optional).
- `status` (string): The status of invoices to filter (e.g., "all").
- `timezone_offset` (integer): The timezone offset in hours.
- `type` (array): An array of types to filter the invoices (optional).

**Response**

On a successful request, the response will return a JSON object with the following structure:

- `total_pages_number` (integer): The total number of pages available based on the current filters.
- `page` (integer): The current page number of the results.
- `invoices` (array): An array of invoice objects, each containing:
  - `id_invoices` (integer): The unique identifier for the invoice.
  - `mark` (string): Any marking associated with the invoice.
  - `date_created` (string): The date the invoice was created.
  - `type` (string): The type of the invoice.
  - `price_total` (number): The total price of the invoice.
  - `paid` (integer): The amount paid against the invoice.
  - `date_delivered` (string): The date the invoice was delivered.
  - `date_issued` (string): The date the invoice was issued.
  - `name` (string): The name associated with the invoice.
  - `advance_remaining_amount` (number): The remaining advance amount.
  - `advance_remaining_pay_amount` (number|null): The remaining amount to be paid (nullable).
  - `id_reservations` (integer): The identifier for any associated reservations.
  - `fiscalized` (integer): Indicates if the invoice is fiscalized (0 or 1).
  - `fiscalized_date` (string|null): The date the invoice was fiscalized (nullable).

**Example Response**

```json
{
  "total_pages_number": 0,
  "page": 0,
  "invoices": [
    {
      "id_invoices": 0,
      "mark": "",
      "date_created": "",
      "type": "",
      "price_total": 0,
      "paid": 0,
      "date_delivered": "",
      "date_issued": "",
      "name": "",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 0,
      "fiscalized": 0,
      "fiscalized_date": null
    }
  ]
}
```

This structure provides a comprehensive overview of the invoices based on the specified filters and pagination.

**Request body** (`raw`)

```json
{
  "id_properties": "93",
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "companies": "0",
  "dfrom": "2021-01-01",
  "dfrom_delivered": "",
  "dto": "2023-09-09",
  "dto_delivered": "",
  "page": 1,
  "search": "",
  "status": "all",
  "timezone_offset": 0,
  "type": []
}
```

**Example response — Get invoices** `200 OK`

```json
{
  "total_pages_number": 3,
  "page": 1,
  "invoices": [
    {
      "id_invoices": 80676,
      "mark": "12-2023",
      "date_created": "2023-06-28 17:14:32",
      "type": "invoice",
      "price_total": 12969,
      "paid": 0,
      "date_delivered": "2023-06-28",
      "date_issued": "2023-06-28",
      "name": "d d",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 457135,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 80672,
      "mark": "11-2023",
      "date_created": "2023-06-28 17:13:16",
      "type": "invoice",
      "price_total": 51996,
      "paid": 0,
      "date_delivered": "2023-06-28",
      "date_issued": "2023-06-28",
      "name": "sad asd",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 457126,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 80670,
      "mark": "10-2023",
      "date_created": "2023-06-28 17:12:30",
      "type": "invoice",
      "price_total": 11,
      "paid": 0,
      "date_delivered": "2023-06-28",
      "date_issued": "2023-06-28",
      "name": "",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 0,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 76587,
      "mark": "9-2023",
      "date_created": "2023-06-13 14:37:51",
      "type": "invoice",
      "price_total": 80,
      "paid": 0,
      "date_delivered": "2023-04-24",
      "date_issued": "2023-04-24",
      "name": "asd asd",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 396449,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 64947,
      "mark": "9-2023",
      "date_created": "2023-04-24 10:44:22",
      "type": "invoice",
      "price_total": 29495,
      "paid": 0,
      "date_delivered": "2023-04-24",
      "date_issued": "2023-04-24",
      "name": "asd asd",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 396449,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 64946,
      "mark": "7-2023",
      "date_created": "2023-04-24 10:42:05",
      "type": "invoice",
      "price_total": 9432,
      "paid": 0,
      "date_delivered": "2023-04-24",
      "date_issued": "2023-04-24",
      "name": "asd asd",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 396449,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 58006,
      "mark": "6-2023",
      "date_created": "2023-03-14 16:29:39",
      "type": "invoice",
      "price_total": 117.9,
      "paid": 0,
      "date_delivered": "2023-03-14",
      "date_issued": "2023-03-14",
      "name": "d d",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 0,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 58005,
      "mark": "5-2023",
      "date_created": "2023-03-14 16:26:17",
      "type": "invoice",
      "price_total": 12370.55,
      "paid": 0,
      "date_delivered": "2023-03-14",
      "date_issued": "2023-03-14",
      "name": "asd asd",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 366898,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 55981,
      "mark": "3-2023",
      "date_created": "2023-03-02 16:30:11",
      "type": "invoice",
      "price_total": 38821.2,
      "paid": 0,
      "date_delivered": "2023-03-02",
      "date_issued": "2023-03-02",
      "name": "Ilija MIlovic",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 358766,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 53935,
      "mark": "1-2023",
      "date_created": "2023-02-17 16:29:57",
      "type": "invoice",
      "price_total": 22736.89,
      "paid": 1,
      "date_delivered": "2023-02-17",
      "date_issued": "2023-02-17",
      "name": "Ilija Milovic",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 350276,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 44461,
      "mark": "2-2022",
      "date_created": "2022-12-06 17:38:55",
      "type": "invoice",
      "price_total": 2349.99459,
      "paid": 1,
      "date_delivered": "2022-12-06",
      "date_issued": "2022-12-06",
      "name": "",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 0,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 44458,
      "mark": "1-2022",
      "date_created": "2022-12-06 16:52:20",
      "type": "invoice",
      "price_total": 121689.991411,
      "paid": 1,
      "date_delivered": "2022-12-06",
      "date_issued": "2022-12-06",
      "name": "Goran Lazarevic",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 307029,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 9317,
      "mark": "37-2021",
      "date_created": "2021-11-30 16:25:11",
      "type": "invoice",
      "price_total": 28.99,
      "paid": 1,
      "date_delivered": "2021-11-30",
      "date_issued": "2021-11-30",
      "name": "NOVI",
      "advance_remaining_amount": 0,
      "advance_remaining_pay_amount": null,
      "id_reservations": 0,
      "fiscalized": 0,
      "fiscalized_date": null
    },
    {
      "id_invoices": 8755,
      "mark": "36-2021",
      "date_created": "2021-11-16 12:19:23",
      "type": "advance_invoice",
      "price_total": 25258.89
```

_(response truncated — original length 8.980 characters)_

---

### Mark invoice as paid <a id="mark-invoice-as-paid"></a>

`POST` `https://app.otasync.me/api/invoices/edit/paid`

**Edit Paid Invoices**

This endpoint allows the user to edit the status of an invoice to mark it as paid.

**Request Body**

- **token** (string): The authentication token for the user, required to authorize the request.
- **id_properties** (string): The ID of the properties associated with the invoice, which helps in identifying the correct property context.
- **key** (string): A unique key for authorization, ensuring that the request is valid and secure.
- **id_invoices** (string): The ID of the invoice to be marked as paid, which specifies which invoice's status should be updated.

**Example Request**

```json
{
    "token": "a5666bee05b0fa91afc5c2f56a6cdc ...",
    "id_properties": "93",
    "key": "574eb98879eb28d03b21e8a5c1a212 ...",
    "id_invoices": "8755"
}
```

**Response**

The response is a JSON object that may include the following properties:

- **status** (string): The status of the request, indicating whether the operation was successful or failed.
- **message** (string): A message providing additional information about the status, which can help in understanding the outcome of the request.

**Example Response**

```json
{
    "status": "success",
    "message": "Invoice marked as paid successfully."
}
```

**Notes**

- Ensure that the token and key are valid before making the request to avoid authentication errors.
- The response may vary based on the success or failure of the operation; always check the status and message for clarity.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "id_properties": "93",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_invoices": "8755"
}
```

**Example response — Mark invoice as paid** `200 OK`

_(empty response body)_

---

### Report advance <a id="report-advance"></a>

`POST` `https://app.otasync.me/api/reports/data/usedAdvanceReport`

**Used Advance Report Data**

This endpoint allows you to retrieve data for a used advance report. It is designed to provide users with specific information related to their advance report requests based on the provided parameters.

**Purpose**

The purpose of this request is to fetch detailed information about used advance reports within a specified date range and based on certain filters. This can be particularly useful for tracking invoices and managing property-related data.

**Request Body**

The request body must be formatted as a JSON object containing the following parameters:

- `token` (string): The authentication token required for accessing the API. This token verifies the user's identity and permissions.
- `id_properties` (string): The ID of the properties for which the report data is being requested. This identifies the specific properties related to the report.
- `key` (string): The key for accessing the report data. This is used to validate the request and ensure that the correct data is returned.
- `dfrom` (string): The start date for the report data in the format `YYYY-MM-DD`. This defines the beginning of the date range for the report.
- `dto` (string): The end date for the report data in the format `YYYY-MM-DD`. This defines the end of the date range for the report.
- `search` (string): The search query for filtering the report data. This can be used to narrow down results based on specific criteria (e.g., invoice numbers).
- `type` (string): The type of report data being requested. This parameter helps specify the nature of the report (e.g., invoice).

**Response**

The response will contain an array of data for the used advance report based on the provided parameters in the request. The structure of the response may vary depending on the input but will typically include relevant details about the used advance reports that match the criteria specified.

This endpoint is crucial for users needing to analyze and report on financial transactions related to their properties, enabling better decision-making and financial oversight.

**Request body** (`raw`)

```json
{
"token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
"id_properties": "93",
"key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
"dfrom":"2024-01-01",
"dto":"2024-01-09",
"search":"A25",
"type":"invoice" //advance

}
```

**Example response — Report advance** `200 OK`

```json
[]
```

---

## Engine <a id="engine"></a>

### Multiproperties <a id="multiproperties"></a>

`POST` `https://app.otasync.me/api/engine/data/properties`

**Retrieve Properties Data**

This endpoint allows you to retrieve a list of properties for a multiproperty, with the option to apply various filter parameters for advanced searching.

**Request Body**

- **id_multiproperties** (required): The ID of the multiproperty.
- **page** (required): The page number.
- **number_of_items**: Number of properties to be displayed per page, defaults to 10.
- **dfrom**: Starting date of reservation to search for.
- **dto**: Ending date of reservation to search for.
- **currency** (required): 3 character currency code (e.g., "EUR").
- **country**: 2 character country code. If provided, only properties from the selected country will be shown.
- **property_type**: List of property types to be filtered by.
- **amenities**: Filters for property amenities.
- **cities**: Filters for cities.
- **destination**: Search string for destination of properties.
- **guests**: Total number of guests.
- **min_price**: Minimum price filter.
- **max_price**: Maximum price filter.

**Response Body**

The response will contain the list of properties based on the applied filters.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Accept` | `application/json` |  |

**Request body** (`raw`)

```json
{
  "id_multiproperties": 9,
  "page": 1,
  "number_of_items": 5,
  "dfrom": "",
  "dto": "",
  "currency": "EUR",
  "country": "",
  "name": "",
  "property_type": [],
  "amenities": [],
  "cities": [],
  "destination": "",
  "guests": 1,
  "min_price": 0,
  "max_price": 0,
  "num_of_houserooms": [],
  "bed_types": [],
  "room_type_amenities": []
}
```

**Example response — Multiproperties** `500 Internal Server Error`

_(empty response body)_

---

## Reviews <a id="reviews"></a>

Review API is a Review data fetching service. Review Data is: Review content, NLP mood detection, NLP categorisation & polarization, scoring and subscoring, author name, author category, author description, author country.The Methods listed in this document are organized under the following Groups:
**Authentication** - Gaining access to the API.
**Summary** - Search by hotel and retrieve information on the Total Reviews, Average Review Score and Average Review Score per Categories.
**Details** - Possibility to fetch individual reviews for specific range of time
**Shop** - if for specific hotel for the summary or details review you get error 401, that means you need to send this hotel to SHOP API and in next 24hrs you will be able to fetch reviews for it.

List of Source Codes:

```
[
  {
    "sourceCode": 1,
    "sourceName": "expedia",
  },
  {
    "sourceCode": 2,
    "sourceName": "booking_com",
  },
  {
    "sourceCode": 5,
    "sourceName": "agoda",
  },
  {
    "sourceCode": 7,
    "sourceName": "goibibo",
  },
  {
    "sourceCode": 12,
    "sourceName": "hotels_com",
  },
  {
    "sourceCode": 283,
    "sourceName": "google",
  },
  {
    "sourceCode": 285,
    "sourceName": "airbnb",
  },
  {
    "sourceCode": 324,
    "sourceName": "tripadvisor",
  }
]
```

**Authorization**

Every request sent to the Reviews API must be authenticated with an access token. You can obtain an access token when you log-in using the credentials provided to you in your ReviewsAPI packet. An access token is valid for 24 hours from the time it is generated.The access token must be appended to the 'Authorization Header' as depicted in the example below:
If 'A90324XXZUZUgpO0dd6npHcM83CJ...' is your access token, every request must contain the following header:

Authorization: {{vault:bearer-token}}

### Auth <a id="auth-1"></a>

`POST` `https://app.otasync.me/api/reviews/auth`

**Authenticated Reviews API**

This API endpoint allows the user to authenticate and access reviews.

**Request Body**

- `username` (string) - The username for authentication.
- `password` (string) - The password for authentication.

**Response**

The response for this request is a JSON object with the following schema:

```json
{
  "token": "string",
  "user_id": "string",
  "expires_in": "string"
}
```

The `token` is the authentication token, `user_id` is the user's ID, and `expires_in` indicates the token expiration duration.

**Request body** (`raw`)

```json
{
  "username": "demo@otasync.me",
  "password": "123456"
}
```

**Example response — Auth** `200 OK`

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6Im9mZmljZUBvdGFzeW5jLm1lIiwidXNlcklkIjoiY2xnMXpybTR4MDAwMGxvcGFoYXU0N3U1NCIsImZ1bGxOYW1lIjoiT1RBIFN5bmMiLCJ0aW1lIjoiMjAyNS0wMi0wN1QxNTozMTo0Mi4wMDZaIiwiaWF0IjoxNzM4OTQyMzAyLCJleHAiOjE3MzkwMjg3MDJ9.Od1SOG0lOu0eDH45GDrI8VAEqhBoIPI9520cSjklJZk",
  "tokenType": "Bearer",
  "expiresIn": "24h",
  ".issued": "Fri, 07 Feb 2025 15:31:42 GMT",
  ".expires": "Sat, 08 Feb 2025 15:31:42 GMT"
}
```

---

### Hotels <a id="hotels"></a>

`POST` `https://app.otasync.me/api/reviews/hotels`

**Add Hotel Reviews**

This endpoint allows you to add hotel reviews.

**Request Body**

- term (string, required): The search term for the hotel.
- city (string, required): The city where the hotel is located.
- state (string, required): The state where the hotel is located.
- country (string, required): The country where the hotel is located.
- zip (string, required): The zip or postal code of the hotel location.
- geoLocationFilter (object, required): The geographical location filter for the search.
  - latitude (string, required): The latitude coordinate for the search.
  - longitude (string, required): The longitude coordinate for the search.
  - radius (string, required): The search radius from the specified coordinates.
- limit (integer, required): The maximum number of results to return.
- showHotelsWithNoReviews (boolean, required): Indicates whether to show hotels with no reviews.

**Response**

The response will contain the status of the request and any relevant data associated with adding hotel reviews.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Authorization` | `Bearer {{vault:json-web-token}}` |  |

**Request body** (`raw`)

```json
{
  "term": "department Store",
  "city": "lNiaocheng",
  "state": "shandong",
  "country": "China",
  "zip": "252500",
  "geoLocationFilter": {
    "latitude": "36.45",
    "longitude": "115.99",
    "radius": "50km"
  },
  "limit": 100,
  "showHotelsWithNoReviews": false
}
```

**Example response — Hotels** `401 Unauthorized`

```json
{
  "error": true,
  "message": "jwt malformed"
}
```

---

### Summary <a id="summary"></a>

`POST` `https://app.otasync.me/api/reviews/summary`

This endpoint allows you to retrieve a summary of reviews for specific hotels from a particular source.

**Request Body**

- **hotelCodes** (array): An array of hotel codes for which the summary is requested.
- **sourceCodes** (array): An array of source codes for which the summary is requested.

**Response**

The response will include the summary of reviews for the specified hotels from the requested sources.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Authorization` | `Bearer {{vault:json-web-token}}` |  |

**Request body** (`raw`)

```json
{
  "hotelCodes": [
    1,
    123
  ],
  "sourceCodes": [
    1,
    283
  ]
}
```

---

### Details <a id="details"></a>

`POST` `https://app.otasync.me/api/reviews/details`

**POST /api/reviews/details**

This endpoint is used to retrieve details of reviews for a specific hotel.

**Request**

The request should be sent as an HTTP POST to the endpoint `https://app.otasync.me/api/reviews/details`. The request body should be in JSON format and include the following parameters:

- `hotelCode` (string): The code of the hotel for which the reviews are being retrieved.
- `sourceCodes` (array): An array of integers representing the source codes for the reviews.
- `reviewDateFilter` (object): An object containing the start and end dates for filtering the reviews based on review date.
  - `start` (string): The start date for the review date filter.
  - `end` (string): The end date for the review date filter.
- `limit` (integer): The maximum number of reviews to be retrieved.
- `offset` (integer): The offset for pagination while retrieving reviews.

Example:

````json
{
  "hotelCode": "1",
  "sourceCodes": [1],
  "reviewDateFilter": {
    "start": "12/30/2022",
    "end": "12/23/2023"
  },
  "limit": 5000,
  "offset": 0
}
#### Response
The response to this request will be a JSON object conforming to the following schema:
```json
{
  "type": "object",
  "properties": {
    // Schema properties for the response
  }
}
````

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Authorization` | `Bearer {{vault:json-web-token}}` |  |

**Request body** (`raw`)

```json
{
  "hotelCode": "1",
  "sourceCodes": [
    1,
    283
  ],
  "reviewDateFilter": {
    "start": "12/30/2022",
    "end": "12/23/2023"
  },
  "limit": 5000,
  "offset": 0
}
```

---

### Shop <a id="shop"></a>

`POST` `https://app.otasync.me/api/reviews/shop`

**POST /api/reviews/shop**

This endpoint is used to retrieve reviews for a specific shop.

**Request Body**

- `hotelCodes` (array of integers) - The codes of the hotels for which reviews are requested.
- `sourceCodes` (array of integers) - The codes of the sources from which reviews are requested.
- `shopName` (string) - The name of the shop for which reviews are requested.
- `reviewsLimit` (integer) - The limit on the number of reviews to be retrieved.

**Response**

The response for this request follows the JSON schema below:

```json
{
  "type": "object",
  "properties": {
    "reviews": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          // Properties of each review object
        }
      }
    }
  }
}
```

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Authorization` | `Bearer {{vault:json-web-token}}` |  |

**Request body** (`raw`)

```json
{
  "hotelCodes": [
    1,
    123
  ],
  "sourceCodes": [
    1,
    283
  ],
  "shopName": "Abc",
  "reviewsLimit": 100
}
```

---

### Schedule <a id="schedule"></a>

`POST` `https://app.otasync.me/api/reviews/schedule`

**Schedule Review Collection**

This endpoint allows you to schedule the collection of reviews for a specific shop.

**Request Body**

- `scheduleName` (string): The name given to the shop for identification.
- `shopId` (number): The unique identifier assigned to the shop.
- `minute` (string): The minute at which the review collection should occur.
- `hour` (string): The hour in 24-hour format at which the review collection should occur.
- `dayOfMonth` (string): The day of the month on which the review collection should occur.
- `month` (string): The month in which the review collection should occur.
- `dayOfWeek` (string): The day of the week on which the review collection should occur.
- `startDate` (string): The date on which the review collection schedule should begin.
- `endDate` (string): The date on which the review collection schedule should end.

**Example**

```json
{
  "scheduleName": "OTA1",
  "shopId": 1234,
  "minute": "00",
  "hour": "12",
  "dayOfMonth": "*",
  "month": "*",
  "dayOfWeek": "*",
  "startDate": "2024-07-05",
  "endDate": "2025-07-05"
}
```

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `Authorization` | `Bearer {{vault:json-web-token}}` |  |

**Request body** (`raw`)

```json
{
  "scheduleName": "OTA1",
  "shopId": 1234,
  "minute": "00",
  "hour": "12",
  "dayOfMonth": "*",
  "month": "*",
  "dayOfWeek": "*",
  "startDate": "2024-07-05",
  "endDate": "2025-07-05"
}
```

---

## Notifications <a id="notifications"></a>

### Insert notification <a id="insert-notification"></a>

`POST` `https://app.otasync.me/api/calendar/insert/notifications`

**Insert Calendar Notifications**

This API endpoint is used to insert notifications into the calendar.

**Request**

- Method: POST
- Endpoint: `https://app.otasync.me/api/calendar/insert/notifications`
- Headers:
  - Content-Type: application/json

**Request Body**

- token (string): The authentication token for the user.
- id_properties (number): The ID of the properties associated with the notification.
- key (string): The key for the notification.
- title (string): The title of the notification.
- description (string): The description of the notification.
- date (string): The date of the notification.
- id_calendar_notifications (string): The ID of the calendar notification.

**Response**

The response of this request is a JSON object with the following schema:

```json
{
  "status": "string",
  "message": "string",
  "data": {
    "notification_id": "string"
  }
}
```

- status (string): The status of the response.
- message (string): A message indicating the result of the request.
- notification_id (string): The ID of the inserted notification.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "id_properties": 93,
  "key": "c9f8f1b5df8be6de9e7a63cc142aa90a71e001ac",
  "title": "Title",
  "description": "Test desc",
  "date": "2023-04-22",
  "id_calendar_notifications": "0"
}
```

**Example response — Insert notification** `201 Created`

_(empty response body)_

---

### Get notifications by date <a id="get-notifications-by-date"></a>

`POST` `https://app.otasync.me/api/calendar/data/notifications`

**Add Calendar Notification Data**

This API endpoint allows you to add calendar notification data by sending an HTTP POST request to the specified URL.

**Request Body**

- `token` (string): The authentication token for accessing the calendar data.
- `key` (string): The key for accessing the calendar data.
- `date` (string): The date for which the notification data is being added (e.g. "2023-04-22").
- `id_properties` (string): The identifier properties for the notification data.

**Response**

The response to this request will include the status of the notification data addition process.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "c9f8f1b5df8be6de9e7a63cc142aa90a71e001ac",
  "date": "2023-04-22",
  "id_properties": "93"
}
```

**Example response — Get notifications by date** `200 OK`

```json
[
  {
    "id_calendar_notifications": 432,
    "title": "sdfsdf",
    "description": "sdfsdf",
    "date": "2023-04-22",
    "status": 0,
    "id_conference_halls_bookings": 0
  },
  {
    "id_calendar_notifications": 414,
    "title": "Title",
    "description": "Test desc",
    "date": "2023-04-22",
    "status": 0,
    "id_conference_halls_bookings": 0
  }
]
```

---

### Get notifications by date range <a id="get-notifications-by-date-range"></a>

`POST` `https://app.otasync.me/api/calendar/data/notifications`

**Add Calendar Notification Data**

This endpoint allows you to add calendar notification data to the app.

**Request Body**

- `token` (string): The authentication token for the user.
- `key` (string): The key for accessing the calendar data.
- `date` (string): The date for which the notification is being added (format: YYYY-MM-DD).
- `id_properties` (string): The properties ID for the notification.

**Response**

The response will include the status of the notification data addition.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "c9f8f1b5df8be6de9e7a63cc142aa90a71e001ac",
  "date": "2023-04-22",
  "id_properties": "93"
}
```

**Example response — Get notifications by date range** `200 OK`

```json
[
  {
    "id_calendar_notifications": 432,
    "title": "sdfsdf",
    "description": "sdfsdf",
    "date": "2023-04-22",
    "status": 0,
    "id_conference_halls_bookings": 0
  },
  {
    "id_calendar_notifications": 414,
    "title": "Title",
    "description": "Test desc",
    "date": "2023-04-22",
    "status": 0,
    "id_conference_halls_bookings": 0
  }
]
```

---

### Get notification <a id="get-notification"></a>

`POST` `https://app.otasync.me/api/calendar/data/notification`

**Add Calendar Notification Data**

This endpoint allows you to add calendar notification data by sending an HTTP POST request to the specified URL.

**Request Body**

- `token` (string): The authentication token for the user.
- `key` (string): The key for accessing the calendar data.
- `id_properties` (string): The identifier for the properties associated with the notification.
- `id_calendar_notifications` (string): The identifier for the calendar notification.

**Response**

The response to the request will depend on the successful addition of the calendar notification data. The details of the response will indicate the status of the operation.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "c9f8f1b5df8be6de9e7a63cc142aa90a71e001ac",
  "id_properties": "93",
  "id_calendar_notifications": "413"
}
```

**Example response — Get notification** `200 OK`

```json
{
  "id_calendar_notifications": 413,
  "title": "Title",
  "description": "Test desc",
  "date": "2023-07-15",
  "status": 1
}
```

---

### Change notification status <a id="change-notification-status"></a>

`POST` `https://app.otasync.me/api/calendar/data/notification`

**Add Calendar Notification Data**

This endpoint allows you to add calendar notification data by sending an HTTP POST request to the specified URL.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The key for authentication and authorization.
- `id_properties` (string): The ID of the properties associated with the notification.
- `id_calendar_notifications` (string): The ID of the calendar notification.
- `date` (string): The date for the notification in the format "YYYY-MM-DD".
- `status` (integer): The status of the notification.

**Response**

The response will contain the result of the request to add the calendar notification data.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "c9f8f1b5df8be6de9e7a63cc142aa90a71e001ac",
  "id_properties": "93",
  "id_calendar_notifications": "413",
  "date": "2023-04-22",
  "status": 1
}
```

**Example response — Change notification status** `200 OK`

```json
{
  "id_calendar_notifications": 413,
  "title": "Title",
  "description": "Test desc",
  "date": "2023-07-15",
  "status": 1
}
```

---

### Delete notification <a id="delete-notification"></a>

`POST` `https://app.otasync.me/api/calendar/delete/notification`

This API endpoint is used to delete a calendar notification. The HTTP POST request should be sent to [https://app.otasync.me/api/calendar/delete/notification](https://app.otasync.me/api/calendar/delete/notification) with the following payload in the raw request body:

```json
{
    "token": "a5666bee05b0fa91afc5c2f56a6cdc ...",
    "key": "c9f8f1b5df8be6de9e7a63cc142aa9 ...",
    "id_properties": "93",
    "id_calendar_notifications": "415"
}
```

The request body should include the "token" for authentication, "key" for authorization, "id_properties" to specify the property, and "id_calendar_notifications" to identify the calendar notification to be deleted.

Upon a successful deletion, the API will return a response with the necessary details. Ensure to handle the response accordingly based on the application's requirements.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "c9f8f1b5df8be6de9e7a63cc142aa90a71e001ac",
  "id_properties": "93",
  "id_calendar_notifications": "415"
}
```

**Example response — Delete notification** `200 OK`

_(empty response body)_

---

### Edit notification <a id="edit-notification"></a>

`POST` `https://app.otasync.me/api/calendar/edit/notifications`

**Add Calendar Notification**

This endpoint allows you to edit calendar notifications.

**Request Body**

- `token` (string): The authentication token for the user.
- `key` (string): The unique key for the notification.
- `id_properties` (string): The ID of the properties associated with the notification.
- `title` (string): The title of the notification.
- `description` (string): The description of the notification.
- `date` (string): The date of the notification.
- `id_calendar_notifications` (string): The ID of the calendar notification.

**Response**

The response will include the status of the request to edit the calendar notification.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "c9f8f1b5df8be6de9e7a63cc142aa90a71e001ac",
  "id_properties": "93",
  "title": "Title",
  "description": "Test desc",
  "date": "2023-04-22",
  "id_calendar_notifications": "413"
}
```

**Example response — Edit notification** `200 OK`

_(empty response body)_

---

### Notification number <a id="notification-number"></a>

`POST` `https://app.otasync.me/api/calendar/data/notificationsNumber`

**Calendar Notifications Number**

This endpoint allows you to retrieve the number of notifications for a specific calendar.

**Request Body**

- token (string): The authentication token for the user.
- id_properties (integer): The ID of the properties.
- key (string): The key for the calendar.
- dfrom (string): The start date for the query.
- dto (string): The end date for the query.
- status (string): The status of the notifications to filter by.

**Response**

The response for this request is a JSON object with the following schema:

```json
{
    "notificationsNumber": {
        "total": "number",
        "unread": "number",
        "read": "number"
    }
}
```

The `notificationsNumber` object contains the total number of notifications, as well as the count of unread and read notifications.

**Request body** (`raw`)

```json
{
    "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
    "id_properties": 93,
    "key": "c9f8f1b5df8be6de9e7a63cc142aa90a71e001ac",
    "dfrom":"2023-01-01",
    "dto":"2023-04-20",
    "status":"all" // read, /unread
}
```

**Example response — Notification number** `200 OK`

```json
{
  "2023-03-03": "1",
  "2023-03-14": "1",
  "2023-04-20": "3"
}
```

---

## E - turista <a id="e---turista"></a>

### Insert to e turist <a id="insert-to-e-turist"></a>

`POST` `https://app.otasync.me/api/eturist_serbia/insert/eturist`

The HTTP POST request to insert data for eturist in Serbia is used to create a new reservation. The request requires a payload with the following parameters:

- token (string): The authentication token for the request.
- key (string): The key for the request.
- guests_ids (string): The ID of the guest for the reservation.
- id_properties (string): The ID of the property for the reservation.
- action (string): The action to be performed, in this case, "reservation".

The response of this request is a JSON schema representing the structure of the response data.

**Request body** (`raw`)

```json
{
    "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
    "key": "c9f8f1b5df8be6de9e7a63cc142aa90a71e001ac",
    "guests_ids": "366898", // id_reservations OR id_guests OR array of id guests ["1992714", "1976337"]
    "id_properties": "93",
    "action": "reservation" // reservation or guests

}
```

**Example response — Insert to e turist** `404 Not Found`

```json
0
```

---

### Get properties from e turist <a id="get-properties-from-e-turist"></a>

`POST` `https://app.otasync.me/api/eturist_serbia/data/GetIdObjectFromETurist`

**GetIdObjectFromETurist**

This endpoint is used to retrieve the ID object from ETurist for a specific set of properties.

**Request Body**

- `token` (string): The authentication token for accessing the ETurist API.
- `key` (string): The key for accessing the ETurist API.
- `id_properties` (string): The ID properties for which the ID object is to be retrieved.

**Response**

The response will contain the ID object from ETurist for the specified properties.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "c9f8f1b5df8be6de9e7a63cc142aa90a71e001ac",
  "id_properties": "93"
}
```

**Example response — Get properties from e turist** `200 OK`

```json
{
  "idObject": [
    {
      "id_marketplace_eturist": 201,
      "id_properties": 93,
      "object_id": " 10004772",
      "object_name": " Test",
      "eturist_username": null,
      "eturist_password": null
    },
    {
      "id_marketplace_eturist": 202,
      "id_properties": 93,
      "object_id": "asd",
      "object_name": "asd",
      "eturist_username": null,
      "eturist_password": null
    }
  ]
}
```

---

### Edit guest with data about e turist <a id="edit-guest-with-data-about-e-turist"></a>

`POST` `https://app.otasync.me/api/guests/edit/guest`

**Edit Guest Details**

This endpoint allows you to edit the details of a guest.

**Request Body Parameters**

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_properties` (integer): The ID of the properties.
- `id_guests` (integer): The ID of the guest.
- `eturstSerbia` (integer): The eturstSerbia value.
- `first_name` (string): The first name of the guest.
- `last_name` (string): The last name of the guest.
- `email` (string): The email address of the guest.
- `company` (string): The company name of the guest.
- `phone` (string): The phone number of the guest.
- `address` (string): The address of the guest.
- `city` (string): The city of the guest.
- `zip` (string): The zip code of the guest.
- `country` (string): The country of the guest.
- `date_of_birth` (string): The date of birth of the guest.
- `gender` (string): The gender of the guest.
- `note` (string): Any additional notes for the guest.
- `DaLiJeLiceDomace` (string): Indicates if the guest is local.
- `DaLiJeLiceRodjenoUnostranstvu` (string): Indicates if the guest was born abroad.
- `birth_guests` (string): The birth date of the guest.
- `jmbg` (string): The JMBG (unique master citizen number) of the guest.
- `OpstinaPrebivalistaNaziv` (string): The name of the municipality of residence.
- `OpstinaPrebivalistaMaticniBroj` (string): The unique identifier of the municipality of residence.
- `MestoPrebivalistaNaziv` (string): The name of the place of residence.
- `DrzavaPrebivalistaAlfa2` (string): The alpha-2 code of the country of residence.
- `UgostiteljskiObjekatJedinstveniIdentifikator` (string): The unique identifier of the hospitality facility.
- ... (other parameters not described here)

**Response**

The response of this request is a JSON object conforming to the following schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  }
}
```

The response contains the `status` and `message` properties indicating the status of the request.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "551632b4b442e3af67b89514c33f7b90351c2e09",
  "id_properties": 93,
  "id_guests": 47965,
  "eturstSerbia": 1,
  "first_name": "xdfdx",
  "last_name": "fsdf",
  "email": "email@email.com",
  "company": null,
  "phone": "123321123",
  "address": "Address",
  "city": "City",
  "zip": "12311",
  "country": "AF",
  "date_of_birth": "1982-03-24",
  "gender": "M",
  "note": "Note",
  "DaLiJeLiceDomace": "true",
  "DaLiJeLiceRodjenoUnostranstvu": "false",
  "birth_guests": "1982-03-24",
  "jmbg": "",
  "OpstinaPrebivalistaNaziv": "ALEKSANDROVAC",
  "OpstinaPrebivalistaMaticniBroj": "70017",
  "MestoPrebivalistaNaziv": "",
  "DrzavaPrebivalistaAlfa2": "RS",
  "UgostiteljskiObjekatJedinstveniIdentifikator": " 10004772",
  "drzavaRodjenja": "RS",
  "vrstaPruzenihUsluga": "1",
  "nacinDolaskasifra": "1",
  "brojSmestajneJedinice": "1",
  "SpratSmestajneJedinice": "1",
  "DatumICasDolaska": "2023-04-18 14:00:00",
  "DatumICasOdolaska": "2023-04-19 10:00:00",
  "UslovZaUmanjenjeBoravisneTakseSifra": "",
  "RazlogBoravkaSifra": "04",
  "MestoRodjenjaNaziv": "",
  "DrzavljanstvoAlfa2": "RS",
  "VrstaPutneIsprave": null,
  "BrojPutneIsprave": "",
  "DatumIzdavanjaPutneIsprave": "",
  "VrstaVize": "0",
  "BrojVize": "",
  "MestoIzdavanjaVize": "",
  "datumUlaskaUSrbiju": "",
  "DatumDoKadaJeOdobrenBoravakURepubliciSrbiji": "Apr 28, 2023",
  "MestoUlaskaUSrbiju": "",
  "MestoUlaskaURepublikuSrbiju": "",
  "NazivAgencije": "",
  "BarkodVaucera": "",
  "BrojPruzenihUslugaSmestaja": "1"
}
```

---

## Montenegro guest <a id="montenegro-guest"></a>

### Insert to guest montenegro <a id="insert-to-guest-montenegro"></a>

`POST` `https://app.otasync.me/api/guests/insert/guest_montenegro`

**POST /api/guests/insert/guest_montenegro**

This endpoint is used to insert a new guest for Montenegro.

**Request**

- Method: POST
- URL: `https://app.otasync.me/api/guests/insert/guest_montenegro`
- Headers:
  - Content-Type: application/json
- { "token": "a5666bee05b0fa91afc5c2f56a6cdc ...", "key": "c9f8f1b5df8be6de9e7a63cc142aa9 ...", "guests": 1976337, "id_properties": "93", "action": "reservation"}

**Response**

The response for this request will be in JSON format and will follow the schema defined by the API.

**Request body** (`raw`)

```json
{
    "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
    "key": "c9f8f1b5df8be6de9e7a63cc142aa90a71e001ac",
    "guests":1976337, // id_reservations OR array of id guests ["1992714"]
    "id_properties": "93",
    "action": "reservation" // reservation or guests

}
```

**Example response — Insert to guest montenegro** `200 OK`

```json
null
```

---

### Edit guest with data about montengro check in <a id="edit-guest-with-data-about-montengro-check-in"></a>

`POST` `https://app.otasync.me/api/guests/edit/guest`

**Edit Guest Information**

This endpoint allows you to edit guest information.

**Request Body**

- `token` (string): The authentication token.
- `key` (string): The key for authentication.
- `id_properties` (integer): The ID of the properties.
- `id_guests` (integer): The ID of the guest.
- `first_name` (string): The first name of the guest.
- `last_name` (string): The last name of the guest.
- `email` (string): The email address of the guest.
- `company` (string): The company of the guest.
- `phone` (string): The phone number of the guest.
- `address` (string): The address of the guest.
- `city` (string): The city of the guest.
- `zip` (string): The zip code of the guest.
- `country` (string): The country of the guest.
- `date_of_birth` (string): The date of birth of the guest.
- `gender` (string): The gender of the guest.
- `note` (string): Additional note for the guest.
- `birthPlace` (string): The birthplace of the guest.
- `guestType` (string): The type of guest.
- `documentIssuer` (string): The issuer of the document.
- `documentIssued` (string): The date of document issuance.
- `documentType` (string): The type of document.
- `documentValid` (string): The validity of the document.
- `entranceDate` (string): The date of entrance.
- `entrancePlace` (string): The place of entrance.
- `departureDate` (string): The date of departure.
- `residenceCountry` (string): The residence country of the guest.
- `birth_date_montenegro` (string): The birth date in Montenegro format.
- `DocumentNumberMontenegro` (string): The document number in Montenegro format.
- `PersonalNumber` (string): The personal number of the guest.

**Response**

The response is a JSON object conforming to a specific schema. Please refer to the JSON schema for the response.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "551632b4b442e3af67b89514c33f7b90351c2e09",
  "id_properties": 93,
  "id_guests": 47965,
  "first_name": "xdfdx",
  "last_name": "fsdf",
  "email": "email@email.com",
  "company": null,
  "phone": "123321123",
  "address": "Address",
  "city": "City",
  "zip": "12311",
  "country": "AF",
  "date_of_birth": "1982-03-24",
  "gender": "M",
  "note": "Note",
  "birthPlace": null,
  "guestType": "4",
  "documentIssuer": null,
  "documentIssued": null,
  "documentType": "1",
  "documentValid": "",
  "entranceDate": "2023-04-18",
  "entrancePlace": null,
  "departureDate": "2023-04-28",
  "residenceCountry": null,
  "birth_date_montenegro": "1982-03-24",
  "DocumentNumberMontenegro": "",
  "PersonalNumber": ""
}
```

**Example response — Edit guest with data about montengro check in** `200 OK`

```json
{
  "id_guests": "47965",
  "id_changelog": 12231808,
  "guest": {
    "id_guests": 47965,
    "id_properties": 93,
    "first_name": "xdfdx",
    "last_name": "fsdf",
    "email": "email@email.com",
    "phone": "123321123",
    "address": "Address",
    "city": "City",
    "zip": "12311",
    "country": "AF",
    "travel_document_number": "",
    "travel_document_type": "--",
    "date_of_birth": "1982-03-24",
    "gender": "M",
    "host_again": null,
    "note": "Note",
    "total_nights": 1,
    "total_arrivals": 1,
    "total_paid": 1.25445,
    "id_companies": "0",
    "exclude_city_tax": 0,
    "merged_to_guest": null,
    "date_merged": null,
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 1,
    "date_modified": "2025-02-07 16:36:57",
    "date_created": "2021-07-15 17:17:25"
  },
  "old_guest": {
    "id_guests": 47965,
    "id_properties": 93,
    "first_name": "xdfdx",
    "last_name": "fsdf",
    "email": "email@email.com",
    "phone": "123321123",
    "address": "Address",
    "city": "City",
    "zip": "12311",
    "country": "AF",
    "travel_document_number": "",
    "travel_document_type": "--",
    "date_of_birth": "1982-03-24",
    "gender": "M",
    "host_again": null,
    "note": "Note",
    "total_nights": 1,
    "total_arrivals": 1,
    "total_paid": 1.25445,
    "id_companies": "0",
    "exclude_city_tax": 0,
    "merged_to_guest": null,
    "date_merged": null,
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 1,
    "date_modified": "2025-02-07 16:36:40",
    "date_created": "2021-07-15 17:17:25"
  }
}
```

---

## New reservations <a id="new-reservations"></a>

### Insert reservation <a id="insert-reservation"></a>

`POST` `https://app.otasync.me/api/reservation/insert/reservation`

The HTTP POST request to the specified endpoint is used to insert a reservation into the system. The request body contains a payload with various details including the reservation key, properties ID, token, reservation status, room details, guest information, pricing, dates, and other relevant reservation attributes.

**Request Body**

- `key` (string): The reservation key
- `id_properties` (string): The ID of the properties
- `token` (string): The token for authorization
- `status` (string): The status of the reservation
- `rooms` (array): An array containing details of the rooms reserved
  - `id_room_types` (integer): The ID of the room type
  - `id_rooms` (string): The ID of the room
  - `room_type` (string): The type of the room
  - `room_number` (string): The room number
  - `avg_price` (integer): The average price of the room
  - `total_price` (integer): The total price for the room
  - `children_1`, `children_2`, `children_3` (integer): Number of children in different age groups
  - `adults` (integer): Number of adult guests
  - `seniors` (integer): Number of senior guests
  - `nights` (array): An array containing details of the nights reserved
    - `night_date` (string): The date of the night
    - `price` (integer): The price for the night
    - `original_price` (integer): The original price for the night
    - `breakfast`, `lunch`, `dinner` (integer): Indicators for meal inclusion
- `guests` (array): An array containing details of the guests
  - `first_name` (string): First name of the guest
  - `last_name` (string): Last name of the guest
  - `id_guests` (integer): The ID of the guest
  - `guest_type` (string): Type of the guest
- Other attributes such as `extras`, `payments`, `discount_type`, `discount_amount`, `rooms_price`, `extras_price`, `city_tax_price`, `insurance_price`, `total_price`, `pending_until`, `reservation_type`, `active_id_room_types`, `reference`, `date_arrival`, `date_departure`, `pricing_plan`, `first_meal`, `id_channels`, `channel`, `reservation_type_label`, `status_label`, `remaining_amount`, `note`, `private_note`, `attachments`, `send_email_to_guest`, `guest_email`, `guest_app_type` are also included in the request body.

**Response Body**

The response to this request will contain the relevant information confirming the successful insertion of the reservation into the system. The specific structure and details of the response body will depend on the system's API and the implementation of the endpoint.

**Request body** (`raw`)

```json
{
  "key": "017d5ab406c4a69b0db04f262a436dcc2dba32d1",
  "id_properties": "93",
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "status": "confirmed",
  "rooms": [
    {
      "id_room_types": 170,
      "id_rooms": "323",
      "room_type": "2BDs",
      "room_number": "AA",
      "avg_price": 95,
      "total_price": 285,
      "children_1": 0,
      "children_2": 0,
      "children_3": 0,
      "adults": 50,
      "seniors": 0,
      "extras": [],
      "payments": [],
      "overbooking": 0,
      "nights": [
        {
          "night_date": "2023-11-27",
          "price": 95,
          "original_price": 95,
          "breakfast": 0,
          "lunch": 0,
          "dinner": 0
        },
        {
          "night_date": "2023-11-28",
          "price": 95,
          "original_price": 95,
          "breakfast": 0,
          "lunch": 0,
          "dinner": 0
        },
        {
          "night_date": "2023-11-29",
          "price": 95,
          "original_price": 95,
          "breakfast": 0,
          "lunch": 0,
          "dinner": 0
        }
      ]
    },
    {
      "id_room_types": 170,
      "id_rooms": "324",
      "room_type": "2BDs",
      "room_number": "2A3",
      "avg_price": 95,
      "total_price": 285,
      "children_1": 0,
      "children_2": 0,
      "children_3": 0,
      "adults": 50,
      "seniors": 0,
      "extras": [
        {
          "id_extras": "16",
          "name": "Extras 1",
          "quantity": 1,
          "price_per_unit": 1179,
          "total_price": 1179
        }
      ],
      "payments": [
        {
          "payment_date": "2023-11-27",
          "method": "virman",
          "amount": 19,
          "id_rooms": "324",
          "pay_with_flutter": 0,
          "created_advance": 0
        }
      ],
      "overbooking": 0,
      "nights": [
        {
          "night_date": "2023-11-27",
          "price": 95,
          "original_price": 95,
          "breakfast": 0,
          "lunch": 0,
          "dinner": 0
        },
        {
          "night_date": "2023-11-28",
          "price": 95,
          "original_price": 95,
          "breakfast": 0,
          "lunch": 0,
          "dinner": 0
        },
        {
          "night_date": "2023-11-29",
          "price": 95,
          "original_price": 95,
          "breakfast": 0,
          "lunch": 0,
          "dinner": 0
        }
      ]
    },
    {
      "id_room_types": 170,
      "id_rooms": "2971",
      "room_type": "2BDs",
      "room_number": "2",
      "avg_price": 95,
      "total_price": 285,
      "children_1": 0,
      "children_2": 0,
      "children_3": 0,
      "adults": 50,
      "seniors": 0,
      "extras": [
        {
          "id_extras": "16",
          "name": "Extras 1",
          "quantity": 1,
          "price_per_unit": 1179,
          "total_price": 1179
        }
      ],
      "payments": [],
      "overbooking": 0,
      "nights": [
        {
          "night_date": "2023-11-27",
          "price": 95,
          "original_price": 95,
          "breakfast": 0,
          "lunch": 0,
          "dinner": 0
        },
        {
          "night_date": "2023-11-28",
          "price": 95,
          "original_price": 95,
          "breakfast": 0,
          "lunch": 0,
          "dinner": 0
        },
        {
          "night_date": "2023-11-29",
          "price": 95,
          "original_price": 95,
          "breakfast": 0,
          "lunch": 0,
          "dinner": 0
        }
      ]
    }
  ],
  "guests": [
    {
      "first_name": "Viktor",
      "last_name": "Test",
      "id_guests": 0,
      "guest_type": "adults"
    }
  ],
  "extras": [],
  "payments": [],
  "children_1": 0,
  "children_2": 0,
  "children_3": 0,
  "adults": 150,
  "seniors": 0,
  "total_guests": 0,
  "discount_type": "percent",
  "discount_amount": 0,
  "discount_note": "",
  "rooms_price": 855,
  "rooms_discounted": 855,
  "extras_price": 2358,
  "board_price": 0,
  "city_tax_price": 4500,
  "insurance_price": 0,
  "total_price": 7713,
  "id_city_taxes": "1",
  "id_boards": "835",
  "id_reservations": 0,
  "pending_until": "2023-11-27",
  "nights": 3,
  "nights_dates": [
    "2023-11-27",
    "2023-11-28",
    "2023-11-29"
  ],
  "reservation_type": "incentive",
  "active_id_room_types": "170",
  "preselected_id_rooms": 0,
  "reference": "reference mobile",
  "id_contigents": 0,
  "date_arrival": "2023-11-27",
  "date_departure": "2023-11-30",
  "id_pricing_plans": "370",
  "pricing_plan": "NETO CIJENA",
  "first_meal": "breakfast",
  "id_channels": "392",
  "channel": "Private reservation",
  "reservation_type_label": "Incentive",
  "status_label": "Confirmed",
  "remaining_amount": 7694,
  "note": "Note 1",
  "private_note": "Private",
  "attachments": [],
  "send_email_to_guest": 0,
  "guest_email": "",
  "guest_app_type": "0"
}
```

**Example response — Insert reservation** `200 OK`

```json
{
  "id_reservations": 1232359,
  "id_changelog": 12231810,
  "id_invoices": null,
  "reservation": {
    "id_reservations": 1232359,
    "id_properties": 93,
    "status": "confirmed",
    "guest_status": "waiting_arrival",
    "reservation_type": "incentive",
    "guest_check_in": null,
    "guest_check_out": null,
    "pending_until": "2023-11-27",
    "pending_time": "",
    "date_received": "2025-02-07",
    "time_received": "16:37:04",
    "date_arrival": "2023-11-27",
    "date_departure": "2023-11-30",
    "date_canceled": null,
    "custom_price": null,
    "nights": 3,
    "total_price": 7798.5,
    "remaining_amount": 7779.5,
    "rooms_price": 855,
    "rooms_discounted": 855,
    "extras_price": 2358,
    "extras_discounted": 2358,
    "city_tax_price": 4500,
    "insurance_price": 0,
    "board_price": 0,
    "board_discounted": 0,
    "conference_halls_price": 0,
    "spas_price": 0,
    "discount_type": "percent",
    "discount_amount": 0,
    "custom_tax_rate": 10,
    "custom_tax_name": "test",
    "custom_tax_price": 85.5,
    "note": "Note 1",
    "private_note": "Private",
    "attachment": null,
    "id_pricing_plans": 370,
    "id_boards": 835,
    "id_city_taxes": 1,
    "id_invoices": null,
    "id_promocodes": "0",
    "id_channels": 392,
    "id_primary_guests": 3300557,
    "children_1": 0,
    "children_2": 0,
    "children_3": 0,
    "children_4": 0,
    "children_5": 0,
    "children_6": 0,
    "children_7": 0,
    "adults": 150,
    "seniors": 0,
    "has_card": "0",
    "total_guests": 150,
    "no_show": null,
    "invalid_cc": null,
    "new_id": null,
    "old_id": null,
    "raw_message": null,
    "parking_count": 0,
    "parking_note": "",
    "additional_services_extra_bed": 0,
    "additional_services_baby_bed": 0,
    "additional_services_flight_time_arrival": "",
    "additional_services_flight_number": "0",
    "meta_data": "",
    "color": "",
    "is_overbooking": 0,
    "unassigned_rooms": 0,
    "id_affiliates": 0,
    "id_multiproperties": 0,
    "id_guest_accounts": 0,
    "id_users": 7,
    "id_bids": 0,
    "id_special_offers": 0,
    "id_contigents": 0,
    "id_companies": null,
    "reference": "reference mobile",
    "external_id": "",
    "field_1": "",
    "field_2": "",
    "field_3": "",
    "field_4": "",
    "exchange_rate": 1,
    "additional_exchange_rate": 1,
    "canceled_reason_reservation": null,
    "offer_cancellation_type": "",
    "channex_modification": 0,
    "channex_modification_date": null,
    "channex_modification_id_changelog": null,
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 0,
    "date_modified": "2025-02-07 16:37:04",
    "date_created": "2025-02-07 16:37:04",
    "pricing_plan_name": "NETO CIJENA",
    "channel_name": "Private reservation",
    "channel_logo": "https://app.otasync.me/img/ota/youbook.png",
    "channel_type": "Private reservation",
    "channel_color": "#3498db",
    "flutterwave_secret_key": "FLWSECK_TEST-xxxxxxxx-REDACTED-X",
    "flutterwave_encryption_key": "FLWSECK_TEST-xxxxxxxx-REDACTED",
    "currency": "EUR",
    "property_name": "Europa Royale Bucharest",
    "first_name": "Viktor",
    "last_name": "Test",
    "email": "",
    "phone": "",
    "country": "",
    "address": "",
    "zip": null,
    "city": "",
    "id_reservations_charge_automation": null,
    "stripe_payment_link_status": null,
    "razorpay_payment_link_status": null,
    "contigent_name": null,
    "company_name": null,
    "policy": "Default policy",
    "policy_description": "",
    "special_offer_name": null,
    "damage": [],
    "changelog": [],
    "guest_app_link": null,
    "guest_registered_colombia": 0,
    "guest_pays": [],
    "incoming_transfers": [],
    "outgoing_transfers": [],
    "guests": [
      {
        "id_rooms": 323,
        "room_number": "AA",
        "id_room_types": 170,
        "room_type_name": "2-Bedroom Apartment with Sea View",
        "room_type_shortname": "2BDs",
        "guest_date_checkin": null,
        "guest_date_checkout": null,
        "guest_status": "waiting_arrival",
        "is_checked_in": 0,
        "channex_guest": 0,
        "id_guest_register_columbia": 52967,
        "type_of_travel_document_co": "",
        "travel_document_number_co": "",
        "city_of_residence_co": "",
        "city_of_origin_co": "",
        "reason_of_the_trip_co": "",
        "rt_number": "",
        "code": null,
        "country_of_residence_co": "",
        "country_of_issued_co": "",
        "id_issued_date_co": "0001-01-01",
        "id_expiration_date_co": "0001-01-01",
        "id_guests": 3300557,
        "id_properties": 93,
        "is_checkin": 0,
        "date_checkin": null,
        "is_checkout": 0,
        "date_checkout": null,
        "guest_type": "adults",
        "id_reservations_rooms": 1828395,
        "id_reservations_guests": 2303746,
        "first_name": "Viktor",
        "last_name": "Test",
        "email": "",
        "phone": "",
        "address": "",
        "city": "",
        "zip": null,
        "country": "",
        "travel_document_number": "",
        "travel_document_type": null,
        "date_of_birth": null,
        "gender": null,
        "host_again": null,
        "note": null,
        "total_nights": 0,
        "total_arrivals": 0,
        "total_paid": 0,
        "id_companies": "0",
        "exclude_city_tax": 0,
        "merged_to_guest": null,
        "date_merged": null,
        "is_deleted": 0,
        "date_deleted": null,
        "is_modified": 0,
        "date_modified": null,
        "date_created": "2025-02-07 16:37:04"
      }
    ],
    "rooms": [
      {
        "id_rooms": 323,
        "room_number": "AA",
        "id_reservations_rooms": 1828395,
        "id_room_types": 170,
        "name": "2-Bedroom Apartment with Sea View",
        "shortname": "2BDs",
        "children_1": 0,
        "children_2": 0,
        "children_3": 0,
        "children_4": 0,
        "children_5": 0,
        "c
```

_(response truncated — original length 36.710 characters)_

---

### Edit reservation basic <a id="edit-reservation-basic"></a>

`POST` `https://app.otasync.me/api/reservation/edit/basics`

The HTTP POST request to edit the basics of a reservation is used to update the details of a specific reservation. The request body should include the reservation ID, token, and the updated reservation details such as status, guest status, reservation type, dates, pricing, guest information, room details, extras, payments, and other relevant information. The response will provide the status of the request and any updated reservation details.

**Request body** (`raw`)

```json
{
  "key": "017d5ab406c4a69b0db04f262a436dcc2dba32d1",
  "id_properties": "93",
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "reservation": {
    "id_reservations": 606306,
    "id_properties": 93,
    "status": "confirmed",
    "guest_status": "waiting_arrival",
    "reservation_type": "incentive",
    "guest_check_in": null,
    "guest_check_out": null,
    "pending_until": "2023-11-27",
    "pending_time": "",
    "date_received": "2023-11-27",
    "time_received": "11:25:23",
    "date_arrival": "2023-11-29",
    "date_departure": "2023-11-30",
    "date_canceled": null,
    "custom_price": null,
    "nights": 3,
    "total_price": "4143.00",
    "remaining_amount": 7779.5,
    "rooms_price": -1215,
    "rooms_discounted": -1215,
    "extras_price": 2358,
    "city_tax_price": 1500,
    "insurance_price": 0,
    "board_price": 1500,
    "conference_halls_price": 0,
    "spas_price": 0,
    "discount_type": "percent",
    "discount_amount": 0,
    "custom_tax_rate": 10,
    "custom_tax_name": "test",
    "custom_tax_price": 85.5,
    "note": "Note 1",
    "private_note": "Private",
    "attachment": null,
    "id_pricing_plans": "371",
    "id_boards": "837",
    "id_city_taxes": 1,
    "id_invoices": null,
    "id_promocodes": "0",
    "id_channels": "392",
    "id_primary_guests": "2512004",
    "children_1": 0,
    "children_2": 0,
    "children_3": 0,
    "adults": 150,
    "seniors": 0,
    "has_card": "0",
    "total_guests": 150,
    "no_show": null,
    "invalid_cc": null,
    "new_id": null,
    "old_id": null,
    "raw_message": null,
    "parking_count": 0,
    "parking_note": "",
    "additional_services_extra_bed": 0,
    "additional_services_baby_bed": 0,
    "additional_services_flight_time_arrival": "",
    "additional_services_flight_number": "0",
    "meta_data": "",
    "color": "",
    "is_overbooking": 0,
    "unassigned_rooms": 0,
    "id_affiliates": 0,
    "id_multiproperties": 0,
    "id_guest_accounts": 0,
    "id_users": null,
    "id_bids": 0,
    "id_contigents": 0,
    "reference": "reference mobile",
    "is_deleted": 0,
    "date_deleted": null,
    "is_modified": 0,
    "date_modified": null,
    "date_created": "2023-11-27 11:25:23",
    "pricing_plan_name": "NETO CIJENA",
    "channel_name": "Private reservation",
    "channel_logo": "https://app.otasync.me/img/ota/youbook.png",
    "channel_type": "Private reservation",
    "channel_color": "#3498db",
    "flutterwave_secret_key": "{{vault:flutterwave-secret-key}}",
    "flutterwave_encryption_key": "{{vault:flutterwave-encryption-key}}",
    "currency": "EUR",
    "first_name": "Viktor",
    "last_name": "Test",
    "email": "",
    "phone": "",
    "country": "",
    "id_reservations_charge_automation": null,
    "stripe_payment_link_status": null,
    "razorpay_payment_link_status": null,
    "guest_app_link": "",
    "guests": [
      {
        "id_rooms": 323,
        "room_number": "AA",
        "id_room_types": 170,
        "room_type_name": "2-Bedroom Apartment with Sea View",
        "room_type_shortname": "2BDs",
        "date_checkin": null,
        "date_checkout": null,
        "guest_status": "waiting_arrival",
        "id_eturist_serbia": 2134929,
        "id_guests": 2512004,
        "DaLiJeLiceDomace": "",
        "DaLiJeLiceRodjenoUInostranstvu": "",
        "jmbg": "",
        "birth_guest": "1970-01-01",
        "MestoRodjenjaNaziv": "",
        "DrzavaRodjenjaAlfa2": "",
        "DrzavaRodjenjaAlfa3": null,
        "DrzavljanstvoAlfa2": "",
        "DrzavljanstvoAlfa3": null,
        "OpstinaPrebivalistaMaticniBroj": "0",
        "OpstinaPrebivalistaNaziv": "",
        "MestoPrebivalistaMaticniBroj": "0",
        "MestoPrebivalistaNaziv": "",
        "DrzavaPrebivalistaAlfa2": "",
        "DrzavaPrebivalistaAlfa3": null,
        "VrstaPutneIspraveSifra": "",
        "BrojPutneIsprave": "",
        "DatumIzdavanjaPutneIsprave": "0001-01-01",
        "VrstaVizeSifra": "",
        "BrojVize": "",
        "MestoIzdavanjaVize": "",
        "DatumUlaskaURepublikuSrbiju": "0001-01-01",
        "MestoUlaskaURepublikuSrbijuSifra": "",
        "MestoUlaskaURepublikuSrbiju": "",
        "DatumDoKadaJeOdobrenBoravakURepubliciSrbiji": "0001-01-01",
        "UgostiteljskiObjekatJedinstveniIdentifikator": "",
        "VrstaPruzenihUslugaSifra": "",
        "NacinDolaskaSifra": "",
        "NazivAgencije": "",
        "BrojSmestajneJedinice": "",
        "SpratSmestajneJedinice": "",
        "DatumICasDolaska": "2023-11-27 14:00:00",
        "PlaniraniDatumOdlaska": "2023-11-30 10:00:00",
        "UslovZaUmanjenjeBoravisneTakseSifra": "",
        "RazlogBoravkaSifra": "",
        "BarkodVaucera": "",
        "dodatNaETurist": 0,
        "ObrisanNaEturist": 0,
        "putnaIspravaVaziDo": null,
        "BrojPruzenihUslugaSmestaja": "3",
        "jedinstveniIdentifikator": null,
        "id_eturist": "2512004",
        "datum_prijave": null,
        "datum_odjave": null,
        "PutnaIspravaVaziDo": null,
        "guest_type": "adults",
        "id_reservations_rooms": 972873,
        "id_properties": 93,
        "first_name": "Viktor",
        "last_name": "Test",
        "email": "",
        "phone": "",
        "address": "",
        "city": "",
        "zip": null,
        "country": "",
        "travel_document_number": null,
        "travel_document_type": null,
        "date_of_birth": null,
        "gender": null,
        "host_again": null,
        "note": null,
        "total_nights": 3,
        "total_arrivals": 1,
        "total_paid": 7798.5,
        "id_companies": "0",
        "exclude_city_tax": 0,
        "is_deleted": 0,
        "date_deleted": null,
        "is_modified": 0,
        "date_modified": null,
        "date_created": "2023-11-27 11:25:23"
      }
    ],
    "rooms": [
      {
        "id_rooms": 323,
        "room_number": "AA",
        "id_reservations_rooms": 972873,
        "id_room_types": 170,
        "name": "2-Bedroom Apartment with Sea View",
        "shortname": "2BDs",
        "children_1": 0,
        "children_2": 0,
        "children_3": 0,
        "adults": 50,
        "seniors": 0,
        "total_guests": 50,
        "avg_price": -405,
        "total_price": -405,
        "first_meal": "none",
        "occupancy": 50,
        "guest_status": "waiting_arrival",
        "status": "confirmed",
        "canceled_reason": null,
        "date_arrival": "2023-11-27",
        "date_departure": "2023-11-30",
        "nights_count": 3,
        "discount_type": "percent",
        "discount_amount": 0,
        "discounted_price": 285,
        "note": null,
        "board_total": 0,
        "city_tax_total": 1500,
        "insurance_total": 0,
        "parking_count": 0,
        "parking_note": null,
        "extra_bed": 0,
        "extra_baby_bed": 0,
        "flight_time_arrival": null,
        "flight_number": null,
        "locked": 0,
        "overbooking": 0,
        "original_id_room_types": 170,
        "original_room_type_prices": 0,
        "nights": [
          {
            "night_date": "2023-11-29",
            "original_price": 95,
            "id_pricing_plans": "371",
            "auto_set_price": 0,
            "board_price_per_day": 500,
            "breakfast": 0,
            "lunch": 0,
            "dinner": 0,
            "price": -405,
            "id_boards": 837
          }
        ]
      },
      {
        "id_rooms": 324,
        "room_number": "2A3",
        "id_reservations_rooms": 972874,
        "id_room_types": 170,
        "name": "2-Bedroom Apartment with Sea View",
        "shortname": "2BDs",
        "children_1": 0,
        "children_2": 0,
        "children_3": 0,
        "adults": 50,
        "seniors": 0,
        "total_guests": 50,
        "avg_price": -405,
        "total_price": -405,
        "first_meal": "none",
        "occupancy": 50,
        "guest_status": "waiting_arrival",
        "status": "confirmed",
        "canceled_reason": null,
        "date_arrival": "2023-11-27",
        "date_departure": "2023-11-30",
        "nights_count": 3,
        "discount_type": "percent",
        "discount_amount": 0,
        "discounted_price": 285,
        "note": null,
        "board_total": 0,
        "city_tax_total": 1500,
        "insurance_total": 0,
        "parking_count": 0,
        "parking_note": null,
        "extra_bed": 0,
        "extra_baby_bed": 0,
        "flight_time_arrival": null,
        "flight_number": null,
        "locked": 0,
        "overbooking": 0,
        "original_id_room_types": 170,
        "original_room_type_prices": 0,
        "nights": [
          {
            "night_date": "2023-11-29",
            "original_price": 95,
            "id_pricing_plans": "371",
            "auto_set_price": 0,
            "board_price_per_day": 500,
            "breakfast": 0,
            "lunch": 0,
            "dinner": 0,
            "price": -405,
            "id_boards": 837
          }
        ]
      },
      {
        "id_rooms": 2971,
        "room_number": "2",
        "id_reservations_rooms": 972875,
        "id_room_types": 170,
        "name": "2-Bedroom Apartment with Sea View",
        "shortname": "2BDs",
        "children_1": 0,
        "children_2": 0,
        "children_3": 0,
        "adults": 50,
        "seniors": 0,
        "total_guests": 50,
        "avg_price": -405,
        "total_price": -405,
        "first_meal": "none",
        "occupancy": 50,
        "guest_status": "waiting_arrival",
        "status": "confirmed",
        "canceled_reason": null,
        "date_arrival": "2023-11-27",
        "date_departure": "2023-11-30",
        "nights_count": 3,
        "discount_type": "percent",
        "discount_amount": 0,
        "discounted_price": 285,
        "note": null,
        "board_total": 0,
        "city_tax_total": 1500,
        "insurance_total": 0,
        "parking_count": 0,
        "parking_note": null,
        "extra_bed": 0,
        "extra_baby_bed": 0,
        "flight_time_arrival": null,
        "flight_number": null,
        "locked": 0,
        "overbooking": 0,
        "original_id_room_types": 170,
        "original_room_type_prices": 0,
        "nights": [
          {
            "night_date": "2023-11-29",
            "original_price": 95,
            "id_pricing_plans": "371",
            "auto_set_price": 0,
            "board_price_per_day": 500,
            "breakfast": 0,
            "lunch": 0,
            "dinner": 0,
            "price": -405,
            "id_boards": 837
          }
        ]
      }
    ],
    "extras": [
      {
        "id_reservation_extras": 215447,
        "id_reservations": 606306,
        "id_extras": 16,
        "quantity": 1,
        "price_per_unit": 1179,
        "total_price": 1179,
        "third_party": 0,
        "additional_service_transfer": 0,
        "id_reservations_rooms": 972874,
        "id_conference_halls_bookings": 0,
        "id_spas_bookings": 0,
        "date_created": "2023-11-27 11:25:23",
        "name": "Extras 1",
        "tax": "0"
      },
      {
        "id_reservation_extras": 215448,
        "id_reservations": 606306,
        "id_extras": 16,
        "quantity": 1,
        "price_per_unit": 1179,
        "total_price": 1179,
        "third_party": 0,
        "additional_service_transfer": 0,
        "id_reservations_rooms": 972875,
        "id_conference_halls_bookings": 0,
        "id_spas_bookings": 0,
        "date_created": "2023-11-27 11:25:23",
        "name": "Extras 1",
        "tax": "0"
      }
    ],
    "payments": [
      {
        "id_reservations_payments": 17898,
        "id_reservations": 606306,
        "method": "virman",
        "amount": 19,
        "payment_date": "2023-11-27",
        "pay_with_flutter": 0,
        "flutter_id": null,
        "created_advance": 0,
        "id_reservations_rooms": 972874
      }
    ],
    "attachments": [],
    "engine_credit_card": null,
    "invoices": [],
    "cc_data": "",
    "update_dates": 1,
    "update_prices": 1,
    "first_meal": "0"
  }
}
```

**Example response — Edit reservation basic** `400 Bad Request`

```html
Some rooms are not available.
```

---

### Update room <a id="update-room"></a>

`POST` `https://app.otasync.me/api/reservation/edit/update_room`

**Update Room Reservation**

This endpoint allows you to update the details of a room reservation.

**Request Body Parameters**

- `key` (string): The authentication key for accessing the API.
- `id_properties` (string): The ID of the property.
- `id_reservations` (integer): The ID of the reservation to be updated.
- `token` (string): The authentication token for the user.
- `room` (object): The details of the room reservation to be updated, including the room ID, room number, guest details, dates, pricing, and additional services.

**Response**

Upon successful update, the response will include the updated details of the room reservation.

**Request body** (`raw`)

```json
{
  "key": "017d5ab406c4a69b0db04f262a436dcc2dba32d1",
  "id_properties": "93",
  "id_reservations": 606306,
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "room": {
    "id_rooms": "2972",
    "room_number": "AA",
    "id_reservations_rooms": 972873,
    "id_room_types": "170",
    "name": "2-Bedroom Apartment with Sea View",
    "shortname": "2BDs",
    "children_1": 0,
    "children_2": 0,
    "children_3": 0,
    "adults": 50,
    "seniors": 0,
    "total_guests": 50,
    "avg_price": -405,
    "total_price": -405,
    "first_meal": "none",
    "occupancy": "50",
    "guest_status": "waiting_arrival",
    "status": "confirmed",
    "canceled_reason": null,
    "date_arrival": "2023-11-29",
    "date_departure": "2023-11-30",
    "nights_count": 1,
    "discount_type": "percent",
    "discount_amount": 11,
    "discounted_price": -405,
    "note": "sdf",
    "board_total": 500,
    "city_tax_total": 500,
    "insurance_total": 0,
    "parking_count": "0",
    "parking_note": "",
    "extra_bed": "0",
    "extra_baby_bed": "0",
    "flight_time_arrival": "",
    "flight_number": "",
    "locked": 0,
    "overbooking": 0,
    "original_id_room_types": 170,
    "original_room_type_prices": 0,
    "nights": [
      {
        "night_date": "2023-11-29",
        "original_price": 96,
        "id_pricing_plans": 371
      }
    ],
    "deleted_extras": [],
    "guests": [
      {
        "id_rooms": 323,
        "room_number": "AA",
        "id_room_types": 170,
        "room_type_name": "2-Bedroom Apartment with Sea View",
        "room_type_shortname": "2BDs",
        "date_checkin": null,
        "date_checkout": null,
        "guest_status": "waiting_arrival",
        "id_eturist_serbia": 2134929,
        "id_guests": 2512004,
        "DaLiJeLiceDomace": "",
        "DaLiJeLiceRodjenoUInostranstvu": "",
        "jmbg": "",
        "birth_guest": "1970-01-01",
        "MestoRodjenjaNaziv": "",
        "DrzavaRodjenjaAlfa2": "",
        "DrzavaRodjenjaAlfa3": null,
        "DrzavljanstvoAlfa2": "",
        "DrzavljanstvoAlfa3": null,
        "OpstinaPrebivalistaMaticniBroj": "0",
        "OpstinaPrebivalistaNaziv": "",
        "MestoPrebivalistaMaticniBroj": "0",
        "MestoPrebivalistaNaziv": "",
        "DrzavaPrebivalistaAlfa2": "",
        "DrzavaPrebivalistaAlfa3": null,
        "VrstaPutneIspraveSifra": "",
        "BrojPutneIsprave": "",
        "DatumIzdavanjaPutneIsprave": "0001-01-01",
        "VrstaVizeSifra": "",
        "BrojVize": "",
        "MestoIzdavanjaVize": "",
        "DatumUlaskaURepublikuSrbiju": "0001-01-01",
        "MestoUlaskaURepublikuSrbijuSifra": "",
        "MestoUlaskaURepublikuSrbiju": "",
        "DatumDoKadaJeOdobrenBoravakURepubliciSrbiji": "0001-01-01",
        "UgostiteljskiObjekatJedinstveniIdentifikator": "",
        "VrstaPruzenihUslugaSifra": "",
        "NacinDolaskaSifra": "",
        "NazivAgencije": "",
        "BrojSmestajneJedinice": "",
        "SpratSmestajneJedinice": "",
        "DatumICasDolaska": "2023-11-29 14:00:00",
        "PlaniraniDatumOdlaska": "2023-11-30 10:00:00",
        "UslovZaUmanjenjeBoravisneTakseSifra": "",
        "RazlogBoravkaSifra": "",
        "BarkodVaucera": "",
        "dodatNaETurist": 0,
        "ObrisanNaEturist": 0,
        "putnaIspravaVaziDo": null,
        "BrojPruzenihUslugaSmestaja": "1",
        "jedinstveniIdentifikator": null,
        "id_eturist": "2512004",
        "datum_prijave": null,
        "datum_odjave": null,
        "PutnaIspravaVaziDo": null,
        "guest_type": "adults",
        "id_reservations_rooms": 972873,
        "id_properties": 93,
        "first_name": "Viktor",
        "last_name": "Test",
        "email": "",
        "phone": "",
        "address": "",
        "city": "",
        "zip": null,
        "country": "",
        "travel_document_number": null,
        "travel_document_type": null,
        "date_of_birth": null,
        "gender": null,
        "host_again": null,
        "note": null,
        "total_nights": 3,
        "total_arrivals": 1,
        "total_paid": 7798.5,
        "id_companies": "0",
        "exclude_city_tax": 0,
        "is_deleted": 0,
        "date_deleted": null,
        "is_modified": 0,
        "date_modified": null,
        "date_created": "2023-11-27 11:25:23"
      }
    ],
    "extras": [
      {
        "id_reservation_extras": 0,
        "id_extras": "9",
        "name": "vecera",
        "quantity": 1,
        "price_per_unit": 1800,
        "total_price": 1800
      }
    ]
  }
}
```

**Example response — Update room** `500 Internal Server Error`

_(empty response body)_

---

### Add room in reservation <a id="add-room-in-reservation"></a>

`POST` `https://app.otasync.me/api/reservation/edit/add_room`

**Add Room Reservation**

This endpoint allows the user to add a room reservation to an existing reservation.

**Request Body**

- key (string): The authentication key for the request.
- id_properties (string): The ID of the property.
- id_reservations (integer): The ID of the reservation.
- token (string): The authentication token.
- room (object): Details of the room reservation including room type, guests, dates, and extras.

**Response**

The response for this request will follow the JSON schema below:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "The status of the request."
    },
    "message": {
      "type": "string",
      "description": "A message providing additional information about the request status."
    },
    "data": {
      "type": "object",
      "description": "Additional data related to the room reservation."
    }
  }
}
```

**Request body** (`raw`)

```json
{
  "key": "9347665c52d5de202a1bf9974dc459234dfd5a38",
  "id_properties": "93",
  "id_reservations": 606308,
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "room": {
    "id_reservations_rooms": 0,
    "id_rooms": "2973",
    "id_room_types": "170",
    "children_1": 0,
    "children_2": 0,
    "children_3": 0,
    "adults": 1,
    "seniors": 0,
    "total_guests": 1,
    "avg_price": 0,
    "total_price": 0,
    "first_meal": "none",
    "guest_status": "waiting_arrival",
    "date_arrival": "2023-11-27",
    "date_departure": "2023-11-30",
    "apply_discount_to": [],
    "nights": [
      {
        "night_date": "2023-11-27",
        "original_price": 95,
        "id_pricing_plans": 370
      },
      {
        "night_date": "2023-11-28",
        "original_price": 95,
        "id_pricing_plans": 370
      },
      {
        "night_date": "2023-11-29",
        "original_price": 95,
        "id_pricing_plans": 370
      }
    ],
    "guests": [
      {
        "id_guests": 0,
        "first_name": "asd",
        "last_name": "asd",
        "guest_type": "adults",
        "guest_status": "waiting_arrival"
      }
    ],
    "extras": [
      {
        "id_reservation_extras": 0,
        "id_extras": "9",
        "name": "vecera",
        "quantity": 1,
        "price_per_unit": 1800,
        "total_price": 1800
      }
    ],
    "deleted_extra": [],
    "discount_type": "percent",
    "discount_amount": 0,
    "locked": 0,
    "original_room_type_prices": 0,
    "occupancy": "50",
    "note": "",
    "parking_count": "",
    "parking_note": "",
    "extra_bed": "",
    "extra_baby_bed": "",
    "flight_time_arrival": "",
    "flight_number": "",
    "overbooking": 0
  }
}
```

**Example response — Add room in reservation** `500 Internal Server Error`

_(empty response body)_

---

### Remove room <a id="remove-room"></a>

`POST` `https://app.otasync.me/api/reservation/edit/remove_room`

**POST /api/reservation/edit/remove_room**

This endpoint is used to remove a room from a reservation.

**Request**

The request should be sent as an HTTP POST to the specified URL with the following parameters in the request body:

- `key` (string): The key for authorization.
- `id_properties` (string): The ID of the property.
- `id_reservations` (integer): The ID of the reservation.
- `reason` (string): The reason for removing the room.
- `token` (string): The authentication token.
- `reservations_rooms_ids` (array of strings): The IDs of the rooms to be removed from the reservation.

**Response**

The response will be in JSON format and will conform to the following schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  }
}
```

The response will include a `status` field indicating the status of the request, and a `message` field providing additional information about the operation.

**Request body** (`raw`)

```json
{
  "key": "017d5ab406c4a69b0db04f262a436dcc2dba32d1",
  "id_properties": "93",
  "id_reservations": 606306,
  "reason": "Test",
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "reservations_rooms_ids": [
    "972875"
  ]
}
```

**Example response — Remove room** `200 OK`

```json
{
  "message": "Success."
}
```

---

### Add extra reservation <a id="add-extra-reservation"></a>

`POST` `https://app.otasync.me/api/reservation/edit/add_extra`

The `POST` request to `/api/reservation/edit/add_extra` endpoint is used to add an extra item to a reservation. The request should include a valid `key`, `id_properties`, `id_reservations`, `token`, and details of the extra item to be added.

**Request Body**

- `key` (string): The key for authorization.
- `id_properties` (string): The ID of the property.
- `id_reservations` (string): The ID of the reservation.
- `token` (string): The authentication token.
- `extra` (object): Details of the extra item to be added.
  - `id_reservation_extras` (string): The ID of the reservation extra (set to 0 for adding a new extra).
  - `id_extras` (string): The ID of the extra item.
  - `name` (string): Name of the extra item.
  - `price_per_unit` (string): Price per unit of the extra item.
  - `quantity` (string): Quantity of the extra item.
  - `id_reservations_rooms` (string): The ID of the reservation room.

**Response**

The response of this request will be a JSON object representing the result of the operation. To document the response as a JSON schema, the actual response data is required to generate the schema.

**Request body** (`raw`)

```json
{
  "key": "ff5744fa9ef662ec56c0fdc65ac0fd0d36a11d60",
  "id_properties": "93",
  "id_reservations": "1232359",
  "extra": {
    "id_reservation_extras": "0",
    "id_extras": "4",
    "name": "Doručak",
    "price_per_unit": "500",
    "quantity": "100",
    "id_reservations_rooms": "1828395",
    "extras_nights": [
      {
        "date": "2023-11-27",
        "quantity": "25"
      },
      {
        "date": "2023-11-28",
        "quantity": "25"
      },
      {
        "date": "2023-11-29",
        "quantity": "25"
      },
      {
        "date": "2023-11-30",
        "quantity": "25"
      }
    ]
  }
}
```

**Example response — Add extra reservation** `200 OK`

```json
{
  "message": "Success."
}
```

---

### Remove extras from reservation <a id="remove-extras-from-reservation"></a>

`POST` `https://app.otasync.me/api/reservation/edit/remove_extra`

**Edit and Remove Extra from Reservation**

This endpoint allows you to edit and remove extra items from a reservation.

**Request Body**

- `key` (text): The authentication key for the request.
- `id_properties` (text): The ID of the property associated with the reservation.
- `id_reservations` (text): The ID of the reservation to be modified.
- `token` (text): The authentication token for the request.
- `reservations_extras_ids` (text): An array of IDs of the extra items to be removed from the reservation.

**Response**

The response will contain the status of the request and any relevant information about the modified reservation.

**Request body** (`raw`)

```json
{
  "key": "017d5ab406c4a69b0db04f262a436dcc2dba32d1",
  "id_properties": "93",
  "id_reservations": 606306,
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "reservations_extras_ids": [
    "215447"
  ]
}
```

**Example response — Remove extras from reservation** `200 OK`

```json
{
  "message": "Success."
}
```

---

### Update extra reservation <a id="update-extra-reservation"></a>

`POST` `https://app.otasync.me/api/reservation/edit/update_extra`

**Update Extra Reservation**

This endpoint allows the user to update extra information for a reservation.

**Request Body**

- key (text, required): The authentication key for the request.
- id_properties (text, required): The ID of the property.
- id_reservations (text, required): The ID of the reservation.
- token (text, required): The authentication token.
- extra (object, required): The extra information to be updated.
  - id_reservation_extras (text, required): The ID of the reservation extra.
  - id_extras (text, required): The ID of the extra.
  - name (text, required): The name of the extra.
  - price_per_unit (text, required): The price per unit of the extra.
  - quantity (text, required): The quantity of the extra.
  - id_reservations_rooms (text, required): The ID of the reservation room.

**Response**

The response for this request will be a JSON object conforming to the following schema:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  }
}
```

The response will contain the status of the request and a message indicating the result of the update operation.

**Request body** (`raw`)

```json
{
  "key": "017d5ab406c4a69b0db04f262a436dcc2dba32d1",
  "id_properties": "93",
  "id_reservations": "606306",
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "extra": {
    "id_reservation_extras": "215448",
    "id_extras": "16",
    "name": "Extras 1",
    "price_per_unit": "1179",
    "quantity": "1",
    "id_reservations_rooms": "972874"
  }
}
```

**Example response — Update extra reservation** `200 OK`

```json
{
  "message": "Success."
}
```

---

### Add payment reservation <a id="add-payment-reservation"></a>

`POST` `https://app.otasync.me/api/reservation/edit/add_payment`

**Add Payment to Reservation**

This endpoint allows you to add a payment to a reservation.

**Request Body**

- `key` (string): The authentication key.
- `id_properties` (string): The ID of the property.
- `id_reservations` (string): The ID of the reservation.
- `token` (string): The authentication token.
- `payment` (object): The payment details.
  - `payment_date` (string): The date of the payment.
  - `amount` (string): The amount of the payment.
  - `method` (string): The payment method.
  - `created_advance` (number): The flag indicating if the payment is created in advance.
  - `id_reservations_rooms` (string): The ID of the reservation room.

**Response Body**

The response will contain the status of the payment addition

**Request body** (`raw`)

```json
{
  "key": "017d5ab406c4a69b0db04f262a436dcc2dba32d1",
  "id_properties": "93",
  "id_reservations": "606306",
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "payment": {
    "payment_date": "2023-11-27",
    "amount": "11",
    "method": "check",
    "created_advance": 0,
    "id_reservations_rooms": "972873"
  }
}
```

**Example response — Add payment reservation** `200 OK`

```json
{
  "id_invoices": null,
  "message": "Success."
}
```

---

### Remove payment reservation <a id="remove-payment-reservation"></a>

`POST` `https://app.otasync.me/api/reservation/edit/remove_payment`

**Edit Reservation Payment Removal**

This endpoint allows you to remove a payment from a reservation.

**Request Body**

- `key` (string): The authentication key for the request.
- `id_properties` (string): The ID of the property associated with the reservation.
- `token` (string): The authentication token for the request.
- `id_reservations` (integer): The ID of the reservation from which the payment needs to be removed.
- `reservations_payments_ids` (array of strings): An array containing the IDs of the payments to be removed from the reservation.

**Response**
The response will indicate the success or failure of the payment removal operation.

**Request body** (`raw`)

```json
{
  "key": "017d5ab406c4a69b0db04f262a436dcc2dba32d1",
  "id_properties": "93",
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "id_reservations": 606306,
  "reservations_payments_ids": [
    "17898"
  ]
}
```

**Example response — Remove payment reservation** `200 OK`

```json
{
  "message": "Success."
}
```

---

### Get reservation <a id="get-reservation"></a>

`POST` `https://app.otasync.me/api/reservation/data/reservation`

**POST /api/reservation/data/reservation**

This endpoint is used to submit reservation data.

**Request**

- **key**: (string) The key for authentication.
- **id_properties**: (string) The ID of the property.
- **id_reservations**: (string) The ID of the reservation.
- **token**: (string) The token for authentication.

The request body should be in raw format and include the following parameters:

```json
{
    "key": "017d5ab406c4a69b0db04f262a436d ...",
    "id_properties": "93",
    "id_reservations": "606308",
    "token": "a5666bee05b0fa91afc5c2f56a6cdc ..."
}
```

**Response**

The response contains the following properties in the JSON format:

- **status**: (string) The status of the reservation.
- **message**: (string) Any additional message related to the reservation submission.

```json
{
    "status": "",
    "message": ""
}
```

**Request body** (`raw`)

```json
{
  "key": "017d5ab406c4a69b0db04f262a436dcc2dba32d1",
  "id_properties": "93",
  "id_reservations": "606308",
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89"
}
```

**Example response — Get reservation** `200 OK`

```json
{
  "id_reservations": 606308,
  "id_properties": 93,
  "status": "confirmed",
  "guest_status": "waiting_arrival",
  "reservation_type": "incentive",
  "guest_check_in": null,
  "guest_check_out": null,
  "pending_until": "2023-11-27",
  "pending_time": "",
  "date_received": "2023-11-27",
  "time_received": "11:28:49",
  "date_arrival": "2023-11-27",
  "date_departure": "2023-11-30",
  "date_canceled": null,
  "custom_price": null,
  "nights": 3,
  "total_price": 9798,
  "remaining_amount": 9779,
  "rooms_price": 1140,
  "rooms_discounted": 1140,
  "extras_price": 4158,
  "extras_discounted": 0,
  "city_tax_price": 4500,
  "insurance_price": 0,
  "board_price": 0,
  "board_discounted": 0,
  "conference_halls_price": 0,
  "spas_price": 0,
  "discount_type": "percent",
  "discount_amount": 0,
  "custom_tax_rate": 10,
  "custom_tax_name": "test",
  "custom_tax_price": 85.5,
  "note": "Note 1",
  "private_note": "Private",
  "attachment": null,
  "id_pricing_plans": 370,
  "id_boards": 835,
  "id_city_taxes": 1,
  "id_invoices": null,
  "id_promocodes": "0",
  "id_channels": 392,
  "id_primary_guests": 2512007,
  "children_1": 0,
  "children_2": 0,
  "children_3": 0,
  "children_4": 0,
  "children_5": 0,
  "children_6": 0,
  "children_7": 0,
  "adults": 151,
  "seniors": 0,
  "has_card": "0",
  "total_guests": 151,
  "no_show": null,
  "invalid_cc": null,
  "new_id": null,
  "old_id": null,
  "raw_message": null,
  "parking_count": 0,
  "parking_note": "",
  "additional_services_extra_bed": 0,
  "additional_services_baby_bed": 0,
  "additional_services_flight_time_arrival": "",
  "additional_services_flight_number": "0",
  "meta_data": "",
  "color": "",
  "is_overbooking": 0,
  "unassigned_rooms": 0,
  "id_affiliates": 0,
  "id_multiproperties": 0,
  "id_guest_accounts": 0,
  "id_users": null,
  "id_bids": 0,
  "id_special_offers": 0,
  "id_contigents": 0,
  "id_companies": null,
  "reference": "reference mobile",
  "external_id": null,
  "field_1": "",
  "field_2": "",
  "field_3": "",
  "field_4": "",
  "exchange_rate": 0,
  "additional_exchange_rate": null,
  "canceled_reason_reservation": null,
  "offer_cancellation_type": "",
  "channex_modification": 0,
  "channex_modification_date": null,
  "channex_modification_id_changelog": null,
  "is_deleted": 0,
  "date_deleted": null,
  "is_modified": 0,
  "date_modified": "2023-11-27 11:28:49",
  "date_created": "2023-11-27 11:28:49",
  "pricing_plan_name": "NETO CIJENA",
  "channel_name": "Private reservation",
  "channel_logo": "https://app.otasync.me/img/ota/youbook.png",
  "channel_type": "Private reservation",
  "channel_color": "#3498db",
  "flutterwave_secret_key": "FLWSECK_TEST-xxxxxxxx-REDACTED-X",
  "flutterwave_encryption_key": "FLWSECK_TEST-xxxxxxxx-REDACTED",
  "currency": "EUR",
  "property_name": "Europa Royale Bucharest",
  "first_name": "Viktor",
  "last_name": "Test",
  "email": "",
  "phone": "",
  "country": "",
  "address": "",
  "zip": null,
  "city": "",
  "id_reservations_charge_automation": null,
  "stripe_payment_link_status": null,
  "razorpay_payment_link_status": null,
  "contigent_name": null,
  "company_name": null,
  "policy": "Default policy",
  "policy_description": "",
  "special_offer_name": null,
  "damage": [],
  "changelog": [],
  "guest_app_link": "",
  "guest_registered_colombia": 0,
  "guest_pays": [],
  "incoming_transfers": [],
  "outgoing_transfers": [],
  "guests": [
    {
      "id_rooms": 323,
      "room_number": "AA",
      "id_room_types": 170,
      "room_type_name": "2-Bedroom Apartment with Sea View",
      "room_type_shortname": "2BDs",
      "guest_date_checkin": null,
      "guest_date_checkout": null,
      "guest_status": "waiting_arrival",
      "is_checked_in": 0,
      "channex_guest": 0,
      "id_guest_register_columbia": null,
      "type_of_travel_document_co": null,
      "travel_document_number_co": null,
      "city_of_residence_co": null,
      "city_of_origin_co": null,
      "reason_of_the_trip_co": null,
      "rt_number": null,
      "code": null,
      "country_of_residence_co": null,
      "country_of_issued_co": null,
      "id_issued_date_co": null,
      "id_expiration_date_co": null,
      "id_guests": 2512007,
      "id_properties": 93,
      "is_checkin": null,
      "date_checkin": null,
      "is_checkout": null,
      "date_checkout": null,
      "guest_type": "adults",
      "id_reservations_rooms": 972877,
      "id_reservations_guests": 1390815,
      "first_name": "Viktor",
      "last_name": "Test",
      "email": "",
      "phone": "",
      "address": "",
      "city": "",
      "zip": null,
      "country": "",
      "travel_document_number": null,
      "travel_document_type": null,
      "date_of_birth": null,
      "gender": null,
      "host_again": null,
      "note": null,
      "total_nights": 3,
      "total_arrivals": 1,
      "total_paid": 7798.5,
      "id_companies": "0",
      "exclude_city_tax": 0,
      "merged_to_guest": null,
      "date_merged": null,
      "is_deleted": 0,
      "date_deleted": null,
      "is_modified": 0,
      "date_modified": null,
      "date_created": "2023-11-27 11:28:49"
    },
    {
      "id_rooms": 2973,
      "room_number": "4",
      "id_room_types": 170,
      "room_type_name": "2-Bedroom Apartment with Sea View",
      "room_type_shortname": "2BDs",
      "guest_date_checkin": null,
      "guest_date_checkout": null,
      "guest_status": "waiting_arrival",
      "is_checked_in": 0,
      "channex_guest": 0,
      "id_guest_register_columbia": null,
      "type_of_travel_document_co": null,
      "travel_document_number_co": null,
      "city_of_residence_co": null,
      "city_of_origin_co": null,
      "reason_of_the_trip_co": null,
      "rt_number": null,
      "code": null,
      "country_of_residence_co": null,
      "country_of_issued_co": null,
      "id_issued_date_co": null,
      "id_expiration_date_co": null,
      "id_guests": 2513164,
      "id_properties": 93,
      "is_check
```

_(response truncated — original length 46.094 characters)_

---

### available RoomTypes And Rooms <a id="available-roomtypes-and-rooms"></a>

`POST` `https://app.otasync.me/api/room/data/availableRoomTypesAndRooms`

**Available Room Types and Rooms**

This endpoint allows you to retrieve available room types and rooms based on the provided parameters.

**Request Body**

- `key` (string): The authentication key for accessing the API.
- `id_properties` (string): The ID of the property for which the available room types and rooms are being requested.
- `dfrom` (string): The start date for the availability search.
- `dto` (string): The end date for the availability search.
- `id_pricing_plans` (integer): The ID of the pricing plan to be considered for availability.
- `real_only` (integer): Flag to indicate if only real rooms should be included.
- `check_restrictions` (integer): Flag to indicate if restrictions should be checked.
- `include_id_reservations_rooms` (integer): The ID of the reservations rooms to be included.
- `allow_overbookings` (integer): Flag to indicate if overbookings are allowed.
- `id_contigents` (integer): The ID of the contigents to be considered.
- `token` (string): The authentication token for accessing the API.

**Response (JSON Schema)**

The response for this request follows the JSON schema defined by the API, which includes information about the available room types and rooms based on the provided parameters.

**Request body** (`raw`)

```json
{
  "key": "017d5ab406c4a69b0db04f262a436dcc2dba32d1",
  "id_properties": "93",
  "dfrom": "2023-11-27",
  "dto": "2023-11-30",
  "id_pricing_plans": 370,
  "real_only": 1,
  "check_restrictions": 1,
  "include_id_reservations_rooms": 972877,
  "allow_overbookings": 1,
  "id_contigents": 0,
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89"
}
```

**Example response — available RoomTypes And Rooms** `200 OK`

```json
[
  {
    "name": "1-Bedroom Apartment with Sea Views",
    "shortname": "TEST",
    "id_room_types": "172",
    "occupancy": "100",
    "parent_id": "0",
    "description": "",
    "area": "0",
    "bathrooms": "1",
    "min_adults": "0",
    "max_adults": "0",
    "min_children": "0",
    "max_children": "0",
    "rooms": [
      {
        "name": "1",
        "id_room_types": "172",
        "id_rooms": "327",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "66",
        "id_room_types": "172",
        "id_rooms": "3035",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "67",
        "id_room_types": "172",
        "id_rooms": "3036",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "68",
        "id_room_types": "172",
        "id_rooms": "3037",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "69",
        "id_room_types": "172",
        "id_rooms": "3038",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "70",
        "id_room_types": "172",
        "id_rooms": "3039",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "71",
        "id_room_types": "172",
        "id_rooms": "3040",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "72",
        "id_room_types": "172",
        "id_rooms": "3041",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "73",
        "id_room_types": "172",
        "id_rooms": "3042",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "74",
        "id_room_types": "172",
        "id_rooms": "3043",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "75",
        "id_room_types": "172",
        "id_rooms": "3044",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "76",
        "id_room_types": "172",
        "id_rooms": "3045",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "77",
        "id_room_types": "172",
        "id_rooms": "3046",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "78",
        "id_room_types": "172",
        "id_rooms": "3047",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "79",
        "id_room_types": "172",
        "id_rooms": "3048",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "80",
        "id_room_types": "172",
        "id_rooms": "3049",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "81",
        "id_room_types": "172",
        "id_rooms": "3050",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "82",
        "id_room_types": "172",
        "id_rooms": "3051",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "83",
        "id_room_types": "172",
        "id_rooms": "3052",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "84",
        "id_room_types": "172",
        "id_rooms": "3053",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "85",
        "id_room_types": "172",
        "id_rooms": "3054",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "86",
        "id_room_types": "172",
        "id_rooms": "3055",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "87",
        "id_room_types": "172",
        "id_rooms": "3056",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "88",
        "id_room_types": "172",
        "id_rooms": "3057",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "89",
        "id_room_types": "172",
        "id_rooms": "3058",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "90",
        "id_room_types": "172",
        "id_rooms": "3059",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "91",
        "id_room_types": "172",
        "id_rooms": "3060",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "92",
        "id_room_types": "172",
        "id_rooms": "3061",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "93",
        "id_room_types": "172",
        "id_rooms": "3062",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "94",
        "id_room_types": "172",
        "id_rooms": "3063",
        "id_floors": "237",
        "floor": "Floor 1"
      },
      {
        "name": "95",
        "id_room_types": "172",
        "id_rooms": "3064",
        "id_floors": "237",
        "floor": "Floor 1"
      }
    ],
    "prices": {
      "2023-11-27": 60,
      "2023-11-28": 60,
      "2023-11-29": 60
    },
    "restrictions": [],
    "restrictions_values": []
  },
  {
    "name": "Studio",
    "shortname": "STD",
    "id_room_types": "174",
    "occupancy": "100",
    "parent_id": "0",
    "description": "",
    "area": "0",
    "bathrooms": "0",
    "min_adults": "0",
    "max_adults": "0",
    "min_children": "0",
    "max_children": "0",
    "rooms": [
      {
        "name": "1",
        "id_room_types": "174",
        "id_rooms": "330",
        "id_floors": "237",
        "floor": "Floor 1"
      }
    ],
    "prices": {
      "2023-11-27": 57,
      "2023-11-28": 57,
      "2023-11-29": 57
    },
    "restrictions": [],
    "restrictions_values": []
  },
  {
    "name": "One-Bedroom Apartment with Sea View - 2px",
    "shortname": "1BD2",
    "id_room_types": "175",
    "occupancy": "2
```

_(response truncated — original length 39.027 characters)_

---

### Get reservations <a id="get-reservations"></a>

`POST` `https://app.otasync.me/api/reservation/data/reservations`

**POST /api/reservation/data/reservations**

This endpoint allows you to retrieve reservation data based on specified filters. The HTTP POST request should be sent to [https://app.otasync.me/api/reservation/data/reservations](https://app.otasync.me/api/reservation/data/reservations).

**Request Body**

The request should include the following parameters in the raw request body:

- `token` (string): The authentication token for accessing the API.
- `key` (string): The key for accessing the API.
- `id_properties` (integer): The ID of the property for which the reservations are being fetched.
- `rooms` (array): An array of room details.
- `channels` (array): An array of channel details.
- `countries` (array): An array of country details.
- `order_by` (string): The parameter by which the reservations are ordered.
- `arrivals` (integer, **optional field**): Filter by number of arrivals.
- `companies` (array, **optional field**): An array of company details.
- `contigents` (array, **optional field**): An array of contingent details.
- `departures` (integer, **optional field**): Filter by number of departures.
- `dfrom` (string, format: YYYY-MM-DD, **optional field**): Start date for filtering reservations.
- `dto` (string, format: YYYY-MM-DD, **optional field**): End date for filtering reservations.
- `last_modified_from` (string, format: YYYY-MM-DD, **optional field**): Start date for filtering who last modified reservations.
- `last_modified_to` (string, format: YYYY-MM-DD, **optional field**): End date for filtering who last modified reservations.
- `filter_by` (string, **optional field**): Specifies the filter type (e.g., "date_received").
- `max_nights` (integer|string, **optional field**): Maximum number of nights.
- `max_price` (integer|string, **optional field**): Maximum price filter.
- `min_nights` (integer|string, **optional field**): Minimum number of nights.
- `min_price` (integer|string, **optional field**): Minimum price filter.
- `multiple_properties` (string|integer, **optional field**): Flag for multiple properties ("0" or "1").
- `offer_expiring` (string|integer, **optional field**): Flag for offer expiring ("0" or "1").
- `order_type` (string, **optional field**): Sorting order (e.g., "desc" for descending).
- `page` (integer, **optional field**): The page number for paginated results.
- `pricing_plans` (array, **optional field**): An array of pricing plan details.
- `search` (string, **optional field**): Search query for reservations.
- `show_nights` (integer, **optional field**): Flag to show nights in results (1 or 0).
- `show_rooms` (integer, **optional field**): Flag to show rooms in results (1 or 0).
- `status` (string|integer, **optional field**): Status filter for reservations.
- `view_type` (string, **optional field**): Specifies the type of view (e.g., "reservations").

**Response Body**

The response will contain the relevant reservation data based on the specified filters.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "channels": [],
  "countries": [],
  "order_by": "date_received",
  "rooms": [],
  "arrivals": 0,
  "companies": [],
  "contigents": [],
  "departures": 0,
  "dfrom": "2023-02-03",
  "dto": "2023-03-05",
  "last_modified_from": "2023-02-03",
  "last_modified_to": "2023-04-03",
  "filter_by": "date_received",
  "max_nights": "",
  "max_price": "",
  "min_nights": "",
  "min_price": "",
  "multiple_properties": "0",
  "offer_expiring": "0",
  "order_type": "desc",
  "page": 1,
  "pricing_plans": [],
  "search": "",
  "show_nights": 1,
  "show_rooms": 1,
  "status": "0",
  "view_type": "reservations"
}
```

**Example response — Get reservations** `200 OK`

```json
{
  "total_pages_number": 1,
  "page": "1",
  "totals": {
    "total": 11,
    "check_in": 0,
    "check_out": 0
  },
  "reservations": [
    {
      "id_reservations": "358766",
      "id_properties": "93",
      "status": "confirmed",
      "guest_status": "waiting_arrival",
      "reservation_type": "incentive",
      "guest_check_in": null,
      "guest_check_out": null,
      "pending_until": "0001-01-01",
      "pending_time": null,
      "date_received": "2023-03-02",
      "time_received": "16:25:44",
      "date_arrival": "2023-03-03",
      "date_departure": "2023-03-08",
      "date_canceled": null,
      "custom_price": null,
      "nights": "5",
      "total_price": "301.27226463104",
      "remaining_amount": "101.27226463104",
      "rooms_price": "280",
      "rooms_discounted": "280",
      "extras_price": "20",
      "extras_discounted": "0",
      "city_tax_price": "1.2722646310433",
      "insurance_price": "0",
      "board_price": "0",
      "board_discounted": "0",
      "conference_halls_price": "0",
      "spas_price": "0",
      "room_discount": "0",
      "extras_discount": "1",
      "board_discount": "0",
      "discount_type": "percent",
      "discount_amount": "0",
      "custom_tax_rate": "0",
      "custom_tax_name": "",
      "custom_tax_price": "0",
      "note": "Trasnfer Needed.",
      "private_note": "",
      "attachment": null,
      "id_pricing_plans": "371",
      "id_boards": "837",
      "id_city_taxes": "1",
      "id_invoices": "55981",
      "id_promocodes": "0",
      "id_channels": "392",
      "id_primary_guests": "94860",
      "children_1": "0",
      "children_2": "0",
      "children_3": "0",
      "children_4": "0",
      "children_5": "0",
      "children_6": "0",
      "children_7": "0",
      "adults": "3",
      "seniors": "0",
      "has_card": "0",
      "total_guests": "3",
      "no_show": null,
      "invalid_cc": null,
      "new_id": null,
      "old_id": null,
      "raw_message": null,
      "parking_count": "0",
      "parking_note": "",
      "additional_services_extra_bed": null,
      "additional_services_baby_bed": null,
      "additional_services_flight_time_arrival": null,
      "additional_services_flight_number": null,
      "meta_data": "",
      "color": "",
      "is_overbooking": "0",
      "unassigned_rooms": "0",
      "id_affiliates": "0",
      "id_multiproperties": "0",
      "id_guest_accounts": "0",
      "id_users": null,
      "id_bids": "0",
      "id_special_offers": "0",
      "id_contigents": "0",
      "id_companies": "0",
      "reference": null,
      "external_id": null,
      "field_1": "",
      "field_2": "",
      "field_3": "",
      "field_4": "",
      "exchange_rate": "0",
      "additional_exchange_rate": null,
      "canceled_reason_reservation": null,
      "offer_cancellation_type": "",
      "channex_modification": "0",
      "channex_modification_date": null,
      "channex_modification_id_changelog": null,
      "is_deleted": "0",
      "date_deleted": null,
      "is_modified": "0",
      "date_modified": "2023-03-02 16:25:44",
      "date_created": "2023-03-02 16:25:44",
      "channel_name": "Private reservation",
      "channel_logo": "https://app.otasync.me/img/ota/youbook.png",
      "first_name": "Ilija",
      "last_name": "MIlovic",
      "email": "ilija@otasync.me",
      "phone": "+382069514878",
      "country": "",
      "gender": "Z",
      "date_of_birth": "0001-01-01",
      "travel_document_number": "",
      "travel_document_type": "--",
      "city": "Tivat",
      "zip": "",
      "address": "Marici bb",
      "pricing_plan_name": "Manual",
      "company_name": null,
      "rooms_include": "no",
      "rooms_tax": "10",
      "guests": [],
      "extras": [],
      "payments": [],
      "invoices": [
        {
          "mark": "3-2023",
          "type": "invoice",
          "id_invoices": "55981",
          "price_total": "38821.2",
          "reservations_modified": "0",
          "fiscalized": "0",
          "paid": "0",
          "id_reservations": "358766",
          "is_deleted": "0"
        }
      ],
      "rooms": [
        {
          "id_rooms": "3035",
          "room_number": "66",
          "id_reservations_rooms": "626472",
          "children_1": "0",
          "children_2": "0",
          "children_3": "0",
          "children_4": "0",
          "children_5": "0",
          "children_6": "0",
          "children_7": "0",
          "adults": "3",
          "seniors": "0",
          "total_guests": "3",
          "avg_price": "56",
          "total_price": "280",
          "first_meal": "none",
          "discount_type": "percent",
          "discount_amount": "0",
          "date_arrival": "2023-03-03",
          "date_departure": "2023-03-08",
          "nights_count": "5",
          "discounted_price": "280",
          "note": null,
          "id_room_types": "172",
          "name": "1-Bedroom Apartment with Sea Views",
          "shortname": "TEST",
          "id_reservations": "358766",
          "status": "confirmed",
          "nights": [
            {
              "id_reservations_nights": "2876684",
              "id_reservations": "358766",
              "id_reservations_rooms": "626472",
              "night_date": "2023-03-03",
              "breakfast": "0",
              "lunch": "0",
              "dinner": "0",
              "price": "55",
              "original_price": "55",
              "id_properties": "93",
              "id_pricing_plans": "371",
              "id_boards": "837",
              "board_price_per_day": "0",
              "board_price_per_day_discounted": "0",
              "breakfast_children_1": "0",
              "breakfast_children_2": "0",
              "breakfast_children_3": "0",
              "breakfast_children_4": "0",
              "breakfast_children_5": "0",
              "breakfast_children_6": "0",
              "breakfast_children_7": "0",
              "breakfast_adults": "0",
```

_(response truncated — original length 198.204 characters)_

---

### Save reservations id <a id="save-reservations-id"></a>

`POST` `https://app.otasync.me/api/reservation/insert/save_reservation_id`

**Save Reservation ID**

This API endpoint is used to save reservation ID by making an HTTP POST request to the specified URL.

**Request Body**

- token (string): The authentication token for the request.
- key (string): The key for the request.
- id_properties (integer): The ID of the properties.
- id_reservations (integer): The ID of the reservations.
- first_name (string): The first name of the individual.
- last_name (string): The last name of the individual.
- document_number (string): The document number of the individual.
- document_type (string): The type of document (e.g., passport, ID card).
- gender (string): The gender of the individual.
- citizenship (string): The citizenship information.
- birth (string): The birth date of the individual.

**Response**

The response for this request is a JSON schema. Please refer to the API documentation for the detailed JSON schema of the response

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "09b04f64a419e9d4dc59a7135c3a1e5e24bc3437",
  "id_properties": 2424,
  "id_reservations": 862015,
  "first_name": "AA",
  "last_name": "AA",
  "document_number": "AA",
  "document_type": "passport",
  "gender": "M",
  "citizenship": "passport",
  "birth": "2023-01-01"
}
```

**Example response — Save reservations id** `200 OK`

```json
{
  "message": "Success",
  "code": 200
}
```

---

### Get reservation types <a id="get-reservation-types"></a>

`POST` `https://app.otasync.me/api/search/data/searchResTypes`

**Search Reservation Types**

This endpoint allows you to search for reservation types based on various criteria.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_properties` (number): The ID of the properties.

**Response Body**

The response will include detailed information about reservation types based on the provided criteria.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93
}
```

**Example response — Get reservation types** `200 OK`

```json
[
  {
    "id_properties_reservation_types": 428,
    "id_properties": 93,
    "name": "incentive"
  }
]
```

---

### Delete reservation <a id="delete-reservation"></a>

`POST` `https://app.otasync.me/api/reservation/delete/delete`

**Delete Reservation**

The `Delete Reservation` endpoint is used to delete a specific reservation.

**Request**

- Method: POST
- Endpoint: `https://app.otasync.me/api/reservation/delete/delete`
- Headers:
  - Content-Type: application/json
- Body:
  - token (string, required): The authentication token for the user.
  - key (string, required): The key for the request.
  - id_properties (integer, required): The ID of the property associated with the reservation.
  - id_reservations (integer, required): The ID of the reservation to be deleted.

**Response**

The response for this request is a JSON object following the schema below:

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "The status of the delete operation."
    },
    "message": {
      "type": "string",
      "description": "A message providing details about the delete operation."
    }
  }
}
```

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_reservations": 81537
}
```

**Example response — Delete reservation** `200 OK`

```json
{
  "reservation": {
    "id_reservations": 81537,
    "id_properties": 93,
    "status": "canceled",
    "guest_status": "waiting_arrival",
    "reservation_type": "incentive",
    "guest_check_in": null,
    "guest_check_out": null,
    "pending_until": "0001-01-01",
    "pending_time": null,
    "date_received": "2021-11-04",
    "time_received": "13:00:56",
    "date_arrival": "2021-10-14",
    "date_departure": "2021-10-16",
    "date_canceled": "2021-11-04 13:03:09",
    "custom_price": null,
    "nights": 2,
    "total_price": 4.5089058524173,
    "remaining_amount": 4.5089058524173,
    "rooms_price": 4,
    "rooms_discounted": 4,
    "extras_price": 0,
    "extras_discounted": 0,
    "city_tax_price": 0.5089058524173,
    "insurance_price": 0,
    "board_price": 0,
    "board_discounted": 0,
    "conference_halls_price": 0,
    "spas_price": 0,
    "discount_type": "percent",
    "discount_amount": 0,
    "custom_tax_rate": 0,
    "custom_tax_name": "",
    "custom_tax_price": 0,
    "note": "",
    "private_note": "",
    "attachment": null,
    "id_pricing_plans": 370,
    "id_boards": 837,
    "id_city_taxes": 1,
    "id_invoices": null,
    "id_promocodes": null,
    "id_channels": 392,
    "id_primary_guests": 94287,
    "children_1": 0,
    "children_2": 0,
    "children_3": 0,
    "children_4": 0,
    "children_5": 0,
    "children_6": 0,
    "children_7": 0,
    "adults": 3,
    "seniors": 0,
    "has_card": "0",
    "total_guests": 3,
    "no_show": null,
    "invalid_cc": null,
    "new_id": null,
    "old_id": null,
    "raw_message": null,
    "parking_count": null,
    "parking_note": null,
    "additional_services_extra_bed": null,
    "additional_services_baby_bed": null,
    "additional_services_flight_time_arrival": null,
    "additional_services_flight_number": null,
    "meta_data": null,
    "color": "",
    "is_overbooking": 0,
    "unassigned_rooms": 0,
    "id_affiliates": null,
    "id_multiproperties": null,
    "id_guest_accounts": null,
    "id_users": null,
    "id_bids": 0,
    "id_special_offers": 0,
    "id_contigents": 0,
    "id_companies": null,
    "reference": null,
    "external_id": null,
    "field_1": "",
    "field_2": "",
    "field_3": "",
    "field_4": "",
    "exchange_rate": 0,
    "additional_exchange_rate": null,
    "canceled_reason_reservation": null,
    "offer_cancellation_type": "",
    "channex_modification": 0,
    "channex_modification_date": null,
    "channex_modification_id_changelog": null,
    "is_deleted": 1,
    "date_deleted": "2025-02-07 16:39:30",
    "is_modified": 0,
    "date_modified": "2021-11-04 13:00:56",
    "date_created": "2021-11-04 13:00:56",
    "pricing_plan_name": "NETO CIJENA",
    "channel_name": "Private reservation",
    "channel_logo": "https://app.otasync.me/img/ota/youbook.png",
    "channel_type": "Private reservation",
    "channel_color": "#3498db",
    "flutterwave_secret_key": "FLWSECK_TEST-xxxxxxxx-REDACTED-X",
    "flutterwave_encryption_key": "FLWSECK_TEST-xxxxxxxx-REDACTED",
    "currency": "EUR",
    "property_name": "Europa Royale Bucharest",
    "first_name": "Test",
    "last_name": "Testic",
    "email": "",
    "phone": "",
    "country": "",
    "address": "",
    "zip": null,
    "city": "",
    "id_reservations_charge_automation": null,
    "stripe_payment_link_status": null,
    "razorpay_payment_link_status": null,
    "contigent_name": null,
    "company_name": null,
    "policy": "Default policy",
    "policy_description": "",
    "special_offer_name": null,
    "damage": [],
    "changelog": [],
    "guest_app_link": "",
    "guest_registered_colombia": 0,
    "guest_pays": [],
    "incoming_transfers": [],
    "outgoing_transfers": [],
    "guests": [
      {
        "id_rooms": 327,
        "room_number": "1",
        "id_room_types": 172,
        "room_type_name": "1-Bedroom Apartment with Sea Views",
        "room_type_shortname": "TEST",
        "guest_date_checkin": null,
        "guest_date_checkout": null,
        "guest_status": "waiting_arrival",
        "is_checked_in": 0,
        "channex_guest": 0,
        "id_guest_register_columbia": null,
        "type_of_travel_document_co": null,
        "travel_document_number_co": null,
        "city_of_residence_co": null,
        "city_of_origin_co": null,
        "reason_of_the_trip_co": null,
        "rt_number": null,
        "code": null,
        "country_of_residence_co": null,
        "country_of_issued_co": null,
        "id_issued_date_co": null,
        "id_expiration_date_co": null,
        "id_guests": 94287,
        "id_properties": 93,
        "is_checkin": null,
        "date_checkin": null,
        "is_checkout": null,
        "date_checkout": null,
        "guest_type": "adults",
        "id_reservations_rooms": 145326,
        "id_reservations_guests": 129847,
        "first_name": "Test",
        "last_name": "Testic",
        "email": "",
        "phone": "",
        "address": "",
        "city": "",
        "zip": null,
        "country": "",
        "travel_document_number": null,
        "travel_document_type": null,
        "date_of_birth": null,
        "gender": null,
        "host_again": null,
        "note": null,
        "total_nights": 0,
        "total_arrivals": 0,
        "total_paid": 0,
        "id_companies": "0",
        "exclude_city_tax": 0,
        "merged_to_guest": null,
        "date_merged": null,
        "is_deleted": 0,
        "date_deleted": null,
        "is_modified": 0,
        "date_modified": null,
        "date_created": "2021-11-04 13:00:55"
      }
    ],
    "rooms": [
      {
        "id_rooms": 327,
        "room_number": "1",
        "id_reservations_rooms": 145326,
        "id_room_types": 172,
        "name": "1-Bedroom Apartment with Sea Views",
        "shortname": "TEST",
        "children_1": 0,
        "children_2": 0,
        "children_3": 0,
        "children_4": 0,
        "children_5": 0,
        "children_6": 0,
        "children_7":
```

_(response truncated — original length 12.365 characters)_

---

### Occupied rooms <a id="occupied-rooms"></a>

`POST` `https://app.otasync.me/api/reservation/data/occupiedRooms`

This HTTP POST request is used to retrieve data on occupied rooms for reservations from the specified endpoint. The request body should contain a token, key, and id_properties. Upon successful execution, the response will include the relevant data for occupied rooms.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93
}
```

**Example response — Occupied rooms** `200 OK`

```json
{
  "status": "ok",
  "rooms": [],
  "banquets": []
}
```

---

### Events <a id="events"></a>

`POST` `https://app.otasync.me/api/reservation/data/events`

**API Request Description**

This endpoint allows the user to send a POST request to [https://app.otasync.me/api/reservation/data/events](https://app.otasync.me/api/reservation/data/events) in order to retrieve reservation data events. The request should include the following parameters in the raw request body:

- `token`: A string representing the user's authentication token.
- `key`: A string representing the key for authentication.
- `id_properties`: A string representing the ID properties.
- `dfrom`: A string representing the start date for the events.
- `dto`: A string representing the end date for the events.

**API Response**

The response for this request is a JSON schema. It will include the schema for the data events related to the reservations. The schema will define the structure and data types of the response object.

**Request body** (`raw`)

```json
{
  "token": "8fba58c5d62f576e0ac309b42df176190f84510d",
  "key": "554625d28542641386cc3652f8fcf7984b7413db",
  "id_properties": "93",
  "dfrom": "2022-04-08",
  "dto": "2022-04-08"
}
```

---

### News <a id="news"></a>

`POST` `https://app.otasync.me/api/reservation/data/news`

**Add Reservation Data News**

This endpoint allows you to add reservation data news by making an HTTP POST request to the specified URL.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The key for authentication and access.
- `id_properties` (string): The ID of the properties for which the news is being added.
- `dfrom` (string): The start date for the news data.
- `dto` (string): The end date for the news data.
- `order_by` (string): The parameter to order the news data by.
- `order_type` (string): The type of ordering (ascending or descending).

**Response**

The response to this request will contain the status of the operation, along with any relevant data or error messages.

**Request body** (`raw`)

```json
{
  "token": "8fba58c5d62f576e0ac309b42df176190f84510d",
  "key": "554625d28542641386cc3652f8fcf7984b7413db",
  "id_properties": "93",
  "dfrom": "2022-04-08",
  "dto": "2022-04-08",
  "order_by": "date_received",
  "order_type": "desc"
}
```

---

### reservationPrices <a id="reservationprices"></a>

`POST` `https://app.otasync.me/api/reservation/data/reservationPrices`

**Add Reservation Prices**

This endpoint allows you to add reservation prices for a specific property, pricing plan, and board. The request should be sent as an HTTP POST to the following URL: `https://app.otasync.me/api/reservation/data/reservationPrices`.

**Request Body**

The request should include the following parameters in the raw request body:

- `id_properties` (string): The ID of the property.
- `key` (string): Authentication key for authorization.
- `id_pricing_plans` (string): The ID of the pricing plan.
- `id_boards` (string): The ID of the board.
- `id_city_taxes` (string): The ID of the city taxes.
- `date_arrival` (string): The arrival date in the format 'YYYY-MM-DD'.
- `token` (string): Token for authorization.
- `date_departure` (string): The departure date in the format 'YYYY-MM-DD'.
- `rooms` (array): An array of room objects containing detailed information about the reservation.

Each room object should include the following parameters:

- `id_rooms` (string): The ID of the room.
- `room_number` (string): The room number.
- `id_reservations_rooms` (string): The ID of the reservation room.
- `id_room_types` (string): The ID of the room type.
- `name` (string): The name of the room.
- `shortname` (string): The short name of the room.
- `children_1` (string): Number of children (age 1) staying in the room.
- `children_2` (string): Number of children (age 2) staying in the room.
- `children_3` (string): Number of children (age 3) staying in the room.
- `adults` (string): Number of adults staying in the room.
- `seniors` (string): Number of seniors staying in the room.
- `total_guests` (string): Total number of guests staying in the room.
- `avg_price` (number): Average price for the room.
- `total_price` (number): Total price for the room.
- `first_meal` (string): The first meal included in the reservation. Each room object should also include a `nights` array, containing night objects with the following parameters:
- `id_reservations_nights` (string): The ID of the reservation night.
- `id_reservations` (string): The ID of the reservation.
- `id_reservations_rooms` (string): The ID of the reservation room.
- `night_date` (string): The date of the night in the format 'YYYY-MM-DD'.
- `breakfast` (string): Indicates if breakfast is included (0 or 1).
- `lunch` (string): Indicates if lunch is included (0 or 1).
- `dinner` (string): Indicates if dinner is included (0 or 1).
- `price` (number): The price for the night.
- `original_price` (string): The original price for the night.
- `id_properties` (string): The ID of the property.

**Response**

The response to the request will contain the result of adding the reservation prices, including any relevant success or error messages.

**Headers**

| Key | Value | Notes |
| --- | --- | --- |
| `token` | `8fba58c5d62f576e0ac309b42df176190f84510d` |  |

**Request body** (`raw`)

```json
{
  "id_properties": "92",
  "key": "f57a6296c978539284a0e652d38ead67e07696ff",
  "id_pricing_plans": "367",
  "id_boards": "828",
  "id_city_taxes": "0",
  "date_arrival": "2022-05-12",
  "token": "8fba58c5d62f576e0ac309b42df176190f84510d",
  "date_departure": "2022-05-13",
  "rooms": [
    {
      "id_rooms": "491",
      "room_number": "202",
      "id_reservations_rooms": "322393",
      "id_room_types": "268",
      "name": "Test soba",
      "shortname": "TSo",
      "children_1": "0",
      "children_2": "0",
      "children_3": "0",
      "adults": "1",
      "seniors": "0",
      "total_guests": "1",
      "avg_price": 10,
      "total_price": 10,
      "first_meal": "lunch",
      "nights": [
        {
          "id_reservations_nights": "1443891",
          "id_reservations": "165978",
          "id_reservations_rooms": "322393",
          "night_date": "2022-05-12",
          "breakfast": "0",
          "lunch": "0",
          "dinner": "0",
          "price": 10,
          "original_price": "10",
          "id_properties": "92"
        }
      ]
    },
    {
      "id_rooms": "322",
      "room_number": "101",
      "id_reservations_rooms": "322394",
      "id_room_types": "169",
      "name": "dasdas",
      "shortname": "2",
      "children_1": 0,
      "children_2": 0,
      "children_3": 0,
      "adults": 1,
      "seniors": 0,
      "total_guests": 1,
      "avg_price": 100,
      "total_price": 100,
      "first_meal": "dinner",
      "nights": [
        {
          "night_date": "2022-05-12",
          "price": 100,
          "original_price": 100,
          "breakfast": 0,
          "lunch": 0,
          "dinner": 0
        }
      ]
    }
  ]
}
```

---

### Insert into order montenegro <a id="insert-into-order-montenegro"></a>

`POST` `https://app.otasync.me/api/invoices/fiscal/order_montenegro`

**Endpoint Description**

This API endpoint is used to create a fiscal invoice for an order in Montenegro.

**Request Body**

- token (string): The authentication token for the request.
- key (string): The key for authentication.
- id_properties (integer): The ID of the properties.
- id_reservations (integer): The ID of the reservations.
- ikof (string): The IKOF value for the invoice.
- total_amount (string): The total amount for the invoice.
- date_issued (string): The date and time of the invoice issuance.
- items (array): An array of objects containing details of the items in the invoice.
  - name (string): The name of the item.
  - quantity (integer): The quantity of the item.
  - price_per_unit (integer): The price per unit of the item.
  - tax (integer): The tax percentage for the item.
  - discount_amount (string): The discount amount for the item.
  - discount_type (string): The type of discount for the item.
- payment_types (array): An array of objects containing details of the payment types for the invoice.
  - amount (integer): The amount paid for the payment type.
  - payment_type (string): The type of payment.

**Response**

The response of this request will be a JSON object conforming to a specific schema. The schema should be documented based on the actual response received from the API.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_reservations": 81538,
  "id_reservations_rooms": 0,
  "ikof": "erewr",
  "total_amount": "121",
  "date_issued": "2022-01-01T20:20:20",
  "items": [
    {
      "name": "Test",
      "quantity": 2,
      "price_per_unit": 100,
      "tax": 21,
      "discount_amount": "50",
      "discount_type": "fixed"
    },
    {
      "name": "Test",
      "quantity": 2,
      "price_per_unit": 100,
      "tax": 21
    },
    {
      "name": "Test",
      "quantity": 2,
      "price_per_unit": 100,
      "tax": 7
    }
  ],
  "payment_types": [
    {
      "amount": 1,
      "payment_type": "cash"
    }
  ]
}
```

**Example response — Insert into order montenegro** `200 OK`

```json
{
  "message": "Success",
  "code": 200
}
```

---

### Search guest <a id="search-guest"></a>

`POST` `https://app.otasync.me/api/search/data/guest`

**Search Guest Data**

This API endpoint allows you to search for guest data using the provided parameters.

**Request**

- Method: POST
- Endpoint: `https://app.otasync.me/api/search/data/guest`
- Headers:
  - Content-Type: application/json
- { "token": "a5666bee05b0fa91afc5c2f56a6cdc ...", "key": "574eb98879eb28d03b21e8a5c1a212 ...", "id_properties": 93, "travel_document_number": "111", "first_name": "sdfds", "last_name": "sdf"}

**Response**

The response for this request is a JSON schema describing the structure of the response data.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "travel_document_number": "111",
  "first_name": "sdfds",
  "last_name": "sdf"
}
```

**Example response — Search guest** `200 OK`

```json
{
  "id_reservations": 0,
  "id_guests": 0
}
```

---

### storn order montenegro <a id="storn-order-montenegro"></a>

`POST` `https://app.otasync.me/api/invoices/fiscal/storn_order_montenegro`

**Add Fiscal Storn Order Montenegro**

This endpoint allows you to add a fiscal storn order for Montenegro.

**Request Body**

- `token` (string): The authentication token.
- `key` (string): The authentication key.
- `id_properties` (integer): The ID of the properties.
- `id_reservations` (integer): The ID of the reservations.
- `original_ikof` (string): The original IKOF.

**Response**

The response will contain the result of the fiscal storn order operation.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_reservations": 81538,
  "original_ikof": "erewr"
}
```

**Example response — storn order montenegro** `200 OK`

```json
{
  "message": "success",
  "code": 200
}
```

---

### Update guest status <a id="update-guest-status"></a>

`POST` `https://app.otasync.me/api/reservation/edit/status`

**Edit Reservation Status**

This API endpoint is used to edit the status of a reservation. The available guest statuses are:

- waiting_arrival
- waiting_arrival_advance
- arrived
- arrived_and_paid
- left

"arrived" and "arrived_and_paid" will trigger check-in, which will update the "guest_check_in", and "left" will update the "guest_check_out" field.

**Request Body**

- token (string): The authentication token
- key (string): The key for authorization
- id_properties (number): The ID of the property
- id_reservation (number): The ID of the reservation
- val (string): The new status value for the reservation

**Response**

The response for this request is a JSON schema. Please refer to the API documentation for the detailed structure of the response.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_reservation": 82550,
  "val": "waiting_arrival_advance"
}
```

**Example response — Update guest status** `200 OK`

_(empty response body)_

---

### Update guest status of specific guests <a id="update-guest-status-of-specific-guests"></a>

`POST` `https://app.otasync.me/api/reservation/edit/guest_status`

**Edit Guest Status**

This endpoint allows you to edit the guest status for a reservation.

**Request Body**

- token (string): The authentication token.
- key (string): The unique key for the request.
- id_properties (number): The ID of the property.
- id_reservations (number): The ID of the reservation.
- status (string): The new status for the guest. Available options are:
  - waiting_arrival
  - waiting_arrival_advance
  - arrived
  - arrived_and_paid
  - left "arrived" and "arrived_and_paid" will trigger check in, which will update the "guest_check_in" and "left" will update the "guest_check_out" field.
- reservations_guests_ids (array of numbers): The IDs of the reservation guests.

**Response (JSON Schema)**

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    }
  }
}
```

The response will include the status of the request and a message indicating the result of the operation.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_reservations": 82550,
  "status": "waiting_arrival_advance",
  "reservations_guests_ids": [
    131276
  ]
}
```

**Example response — Update guest status of specific guests** `200 OK`

```json
{
  "status": 200,
  "message": "Guest status updated."
}
```

---

### Update reservation room status <a id="update-reservation-room-status"></a>

`POST` `https://app.otasync.me/api/reservation/edit/room_guest_status`

**Edit Room Guest Status**

This endpoint allows you to edit the status of a room guest for a specific reservation.

**Request**

- Method: POST
- URL: `https://app.otasync.me/api/reservation/edit/room_guest_status`
- Headers:
  - Content-Type: application/json
- Body:
  - token (string): The authentication token for the request.
  - key (string): The key for the request.
  - id_properties (number): The ID of the property.
  - id_reservations (number): The ID of the reservation.
  - id_reservations_rooms (string): The ID of the reservation room.
  - status (string): The new status for the room guest.

**Response**

The response to the request will depend on the success or failure of the operation. Details of the response will be provided accordingly.

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "574eb98879eb28d03b21e8a5c1a21259a9a5c85f",
  "id_properties": 93,
  "id_reservations": 81538,
  "id_reservations_rooms": "1134476",
  "status": "arrived"
}
```

---

### POS <a id="pos"></a>

`POST` `https://app.otasync.me/api/reservation/insert/reservationExtra`

**Add Reservation Extra**

This endpoint allows you to add an extra reservation to a property.

**Request Body**

- `key` (string): The authentication key for the request.
- `id_properties` (string): The ID of the property for the reservation.
- `id_reservations` (string): The ID of the reservation.
- `id_reservations_rooms` (integer): The ID of the reservation room.
- `extras` (array):
  - `name` (string): The name of the extra item.
  - `quantity` (string): The quantity of the extra item.
  - `price_per_unit` (string): The price per unit of the extra item.
  - `tax` (string): The tax applied to the extra item.
  - `total_price` (string): The total price of the extra item.

**Response**

The response will contain the status of the request, along with any relevant data or error messages.

**Request body** (`raw`)

```json
{
  "key": "e784897a700b6553b8211c72b8f24f42d4907343",
  "id_properties": "93",
  "id_reservations": "1214127",
  "id_reservations_rooms": 1804226,
  "extras": [
    {
      "name": "TOPLA COKOLADA",
      "quantity": "1",
      "price_per_unit": "265.00",
      "tax": "20.00",
      "total_price": "265"
    }
  ]
}
```

**Example response — POS** `200 OK`

```json
{
  "status": "ok"
}
```

---

### Send message <a id="send-message"></a>

`POST` `https://app.otasync.me/api/reservation/insert/message`

**Request body** (`raw`)

```json
{
  "id_properties": 93,
  "key": "3d0ee49a1c183fc343c0daf7ed1d117fdec7e810",
  "body": "{{ message }}",
  "id_reservations": 2271984,
  "attachment": "{{ url_attachment }}"
}
```

---

### Get messages <a id="get-messages"></a>

`POST` `https://app.otasync.me/api/reservation/data/messages`

**Request body** (`raw`)

```json
{
  "id_properties": 93,
  "key": "3d0ee49a1c183fc343c0daf7ed1d117fdec7e810",
  "id_reservations": 2271984
}
```

---

## Inventory <a id="inventory"></a>

### update inventory rooms <a id="update-inventory-rooms"></a>

`POST` `http://localhost/OTASync-DB/OTASync-DB/api/inventory/edit/update_inventory_rooms`

**Update Inventory Rooms**

This endpoint allows you to update the inventory of rooms with the specified details.

**Request Body**

- `key` (string): The authentication key for the request.
- `id_rooms` (string): The ID of the room to be updated.
- `id_room_types` (string): The ID of the room type.
- `id_properties` (string): The ID of the property.
- `id_extras` (string): The ID of the extra amenities.
- `rooms` (array): An array of objects containing the following details for the rooms to be updated:
  - `id_rooms` (string): The ID of the room.
  - `id_room_types` (string): The ID of the room type.
  - `id_extras` (string): The ID of the extra amenity.
  - `quantity` (string): The quantity of the room available.

**Response**

The response will contain the status of the update operation.

**Request body** (`raw`)

```json
{
  "key": "a732345968a4b85e80c86f71bdd749b84912f4e3",
  "id_rooms": "1166",
  "id_room_types": "422",
  "id_properties": "251",
  "id_extras": "1398",
  "rooms": [
    {
      "id_rooms": "1166",
      "id_room_types": "422",
      "id_extras": "1355",
      "quantity": "20"
    },
    {
      "id_rooms": "1167",
      "id_room_types": "422",
      "id_extras": "1355",
      "quantity": "20"
    }
  ]
}
```

---

## Banquet <a id="banquet"></a>

### Add extra banquet <a id="add-extra-banquet"></a>

`POST` `https://app.otasync.me/api/conference_halls_bookings/insert/conference_halls_bookings_extras`

**Conference Halls Bookings Extras Insertion**

This API endpoint allows you to insert extra items for a specific conference hall booking.

**Request Body**

- `token` (string): The authentication token for the request.
- `key` (string): The key for the request.
- `id_properties` (integer): The ID of the properties.
- `id_conference_halls_bookings` (integer): The ID of the conference hall booking.
- `extras` (array): An array of objects containing details of the extra items.
  - `name` (string): The name of the extra item.
  - `quantity` (integer): The quantity of the extra item.
  - `price_per_unit` (integer): The price per unit of the extra item.
  - `tax` (integer): The tax applied to the extra item.
  - `total_price` (integer): The total price of the extra item.

**Response (JSON Schema)**

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string"
    },
    "message": {
      "type": "string"
    },
    "data": {
      "type": "object",
      "properties": {
        "id": {
          "type": "integer"
        }
      }
    }
  }
}
```

**Request body** (`raw`)

```json
{
  "token": "a5666bee05b0fa91afc5c2f56a6cdcfd57a58c89",
  "key": "5f9eca58fce9d556e8fc03df1f089264cd6c94cc",
  "id_properties": 251,
  "id_conference_halls_bookings": 31,
  "extras": [
    {
      "name": "Coca-Cola",
      "quantity": 5,
      "price_per_unit": 500,
      "tax": 10,
      "total_price": 2500
    }
  ]
}
```

**Example response — Add extra banquet** `401 Unauthorized`

```html
Session key invalid
```

---

## Evisitor <a id="evisitor"></a>

## Companies <a id="companies"></a>

### Get companies <a id="get-companies"></a>

`POST` `https://app.otasync.me/api/property/data/companiesSearch`

**Request body** (`raw`)

```json
{
  "key": "947e0d12a3dd0d003e36416c000d239824a4da00",
  "token": "8472b1735e0c61a29e9ae195e7c7165d3164c72c",
  "search": "111945024",
  "country": "RS"
}
```

---

