import * as functions from "firebase-functions";
import { UserRecord } from "firebase-functions/v1/auth";
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, QueryDocumentSnapshot, } from 'firebase-admin/firestore';
import { EventContext } from "firebase-functions";


initializeApp();
const db = getFirestore();

// // Start writing functions
// // https://firebase.google.com/docs/functions/typescript
//
// export const helloWorld = functions.https.onRequest((request, response) => {
//  functions.logger.info("Hello logs!", {structuredData: true});
//  response.send("Hello from Firebase!");
// });

interface CustomClaims {
    role: string,
    accessLevel?: number
}

interface Credentials {
    user: UserRecord,
    password?: string,
}

interface Account {
    credentials: Credentials,
    profile: Profile
}

interface Profile {
    uid: string,
    firstname?: string,
    lastname?: string,
    email?: string,
    password?: string,
}

interface Transaction {
    uid? : string,
    account_name?: string,
    account_number: string,
    transaction_date: string,
    label: string,
    categorie: string,
    sub_categorie: string,
    amount: number,
    user_uid?: string
}

export const profileConverter = {
    toFirestore: (profile: Profile) => {
        return (({ uid, password, ...rest }) => rest)(profile);;
    },
    fromFirestore: (snapshot: QueryDocumentSnapshot) => {
        const profile = snapshot.data() as Profile;
        profile.uid = snapshot.id
        return profile;
    }
};


const setCustomClaims = async function (user: UserRecord, customClaims: CustomClaims) {

    console.log({ customClaims })
    // Check if user meets role criteria.
    if (
        user.email &&
        //context.user.email.endsWith('@admin.example.com') &&
        user.emailVerified
    ) {
        try {
            // Set custom user claims on this newly created user.
            await getAuth().setCustomUserClaims(user.uid, customClaims);

        } catch (error) {
            console.log(error);
        }
    }
}


exports.createAccount = functions.https.onCall(async (account: Account, context) => {

    let user: UserRecord = {} as UserRecord
    await getAuth()
        .createUser({
            email: account.credentials.user.email,
            password: account.credentials.password,
            displayName: account.profile.firstname + ' ' + account.profile.lastname
        })
        .then(async (userRecord: UserRecord) => {

            const data = {
                role: 'user',
                ...account.profile
            };

            await db.collection('profiles').doc(userRecord.uid).set(data);

            account.credentials.user = userRecord;
        })
        .catch((error) => {
            throw new functions.https.HttpsError('internal', 'Error creating new user', error);
        });



    return user
});


exports.fetchAccounts = functions.https.onCall(async (param: any, context): Promise<Account[]> => {
    let accounts: Account[] = [] as Account[]
    if (!context.auth || context.auth.token.role != 'admin') {
        throw new functions.https.HttpsError('permission-denied', 'Only administrators are allowed to access this function.');
    }
    const profilesRef = db.collection('profiles').withConverter(profileConverter);
    const snapshot = await profilesRef.get();

    
    for(let index in snapshot.docs) {
        let profile = snapshot.docs[index].data()

        let user = await getAuth().getUser(profile.uid);

        accounts.push({
            profile: profile,
            credentials: {
                user: user
            }
        })

    }

    return accounts


})

exports.setAccount = functions.https.onCall(async (account: Account, context) => {
    if (!context.auth || 
        (context.auth.token.role != 'admin' && context.auth.uid != account.profile.uid)) {
        throw new functions.https.HttpsError('permission-denied', 'Only administrators are allowed to access this function.');
    }
    await db.collection('profiles').doc(account.profile.uid).withConverter(profileConverter).set(account.profile);
    return account
})


exports.updateProfiles = functions.firestore
    .document("profiles/{profileId}")
    .onWrite(async (change, context: EventContext) => {
        const { after } = change;
        if (!after.exists) {
            // delete
            // nothing to do
            return;
        }

        console.log({ context })
        let user = await getAuth().getUser(context.params.profileId);

        console.log({ data: after.data() })
        const customClaims: CustomClaims = {
            role: after.data()?.role,
            accessLevel: 9
        };


        setCustomClaims(user, customClaims)


    })

exports.deleteTransactions = functions.https.onCall(async (transactions: Transaction[], context) => {
        const deletedTransactions = []
        for(let transaction of transactions) {
            if (!context.auth || 
                (context.auth.token.role != 'admin' && context.auth.uid != transaction.user_uid)) {
                console.log(`transaction ${transaction.uid} can't by delete by ${context.auth?.uid}`)
            }
        
            if(transaction.uid) {
                await db.collection('transactions').doc(transaction.uid).delete();
                deletedTransactions.push(transaction)
            }
                
        }
        return deletedTransactions;
    })