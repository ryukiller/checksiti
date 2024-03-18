const axios = require('axios');
require('dotenv').config();

const baseurl = "https://www.wrike.com/api/v4/";

axios
    .get(baseurl + `ids?ids=[${process.env.TASK_V2_ID}]&type=ApiV2Task`,
        {
            headers: {
                "Content-Type": "application/json",
                "Authorization": "bearer " + process.env.WRIKETOKEN
            },
        })
    .then(res => {
        console.log(`statusCode: ${res.status}`);
        console.log(res.data);
    })
    .catch(error => {
        console.error(error);
    });

// axios
//     .get(baseurl + `tasks/${process.env.TASK_ID}/comments`,
//         {
//             headers: {
//                 "Content-Type": "application/json",
//                 "Authorization": "bearer " + process.env.WRIKETOKEN
//             },
//         })
//     .then(res => {
//         console.log(`statusCode: ${res.status}`);
//         console.log(res.data);
//     })
//     .catch(error => {
//         console.error(error);
//     });