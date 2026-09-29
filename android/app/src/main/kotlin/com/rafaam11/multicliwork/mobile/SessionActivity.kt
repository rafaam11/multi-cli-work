package com.rafaam11.multicliwork.mobile

import android.content.Context
import android.content.Intent
import androidx.activity.ComponentActivity

class SessionActivity : ComponentActivity() {
    companion object {
        const val EXTRA_HOST_ID = "hostId"
        fun intent(context: Context, hostId: String) = Intent(context, SessionActivity::class.java).putExtra(EXTRA_HOST_ID, hostId)
    }
}
